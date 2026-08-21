import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Camera, CloudUpload, ImagePlus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useTranslation } from '@/i18n/I18nProvider'
import { useContainerDetail } from './useContainerDetail'
import { useContainerScanning, type RecordScanResult } from './useContainerScanning'
import { useContainerSettings } from './useContainerSettings'
import { resolveUnknownCode } from './useUnknownCodes'
import { ContainerSummaryHeader } from './ContainerSummaryHeader'
import { ItemComparisonTable } from './ItemComparisonTable'
import { BarcodeScannerPanel } from './BarcodeScannerPanel'
import { UsbScannerInput } from './UsbScannerInput'
import { UnknownCodeResolveDialog } from './UnknownCodeResolveDialog'
import { PhotoOcrCapture, type OcrCaptureResult } from './PhotoOcrCapture'
import type { ScanMethod } from '@/types/database'
import type { ScanEvent, UnknownCode } from './types'

interface ScanExtra {
  confirmOver?: boolean
  confirmDuplicate?: boolean
  confidence?: number | null
  corrected?: boolean
  photoBlob?: Blob | null
}

type LastScan = {
  productName: string
  calidad: string | null
  code: string
  scannedQty: number | null
  expectedQty: number | null
  matchStatus: RecordScanResult['match_status']
}

export function ActiveContainerScreen() {
  const { containerId } = useParams<{ containerId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'
  const { t } = useTranslation()

  const {
    container,
    items,
    itemsWithProgress,
    events,
    unknownCodes,
    totals,
    loading,
    error,
    reload,
    appendLocalEvent,
    reloadUnknownCodesOnly,
    setContainerStatusLocal,
  } = useContainerDetail(containerId ?? null)
  const { settings } = useContainerSettings(container?.branch_id)
  const { recordScan, undoScan, submitting, pendingCount } = useContainerScanning(
    containerId ?? '',
    settings.duplicate_scan_window_ms,
    itemsWithProgress,
    reload
  )

  const [codeInput, setCodeInput] = useState('')
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [pendingOver, setPendingOver] = useState<{ code: string; delta: number; method: ScanMethod; extra: ScanExtra } | null>(null)
  const [pendingDuplicate, setPendingDuplicate] = useState<{ code: string; delta: number; method: ScanMethod; extra: ScanExtra } | null>(
    null
  )
  const [cameraOn, setCameraOn] = useState(false)
  const [photoOn, setPhotoOn] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<UnknownCode | null>(null)
  const [starting, setStarting] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeReason, setCompleteReason] = useState('')
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submitScan = useCallback(
    async (code: string, delta: number, method: ScanMethod, extra: ScanExtra = {}) => {
      if (!code.trim()) return
      setScanError(null)
      const { result, error, overExpected, debouncedSilently, needsDuplicateConfirm } = await recordScan(code.trim(), method, {
        delta,
        confirmOver: extra.confirmOver,
        confirmDuplicate: extra.confirmDuplicate,
        confidence: extra.confidence,
        corrected: extra.corrected,
        photoBlob: extra.photoBlob,
      })

      if (debouncedSilently) return
      if (needsDuplicateConfirm) {
        setPendingDuplicate({ code: code.trim(), delta, method, extra })
        return
      }
      if (overExpected) {
        setPendingOver({ code: code.trim(), delta, method, extra })
        return
      }
      if (error) {
        setScanError(error)
        return
      }
      if (!result) return

      if (result.container_item_id) {
        const item = items.find((i) => i.id === result.container_item_id)
        setLastScan({
          productName: item?.product_name ?? '—',
          calidad: item?.calidad ?? null,
          code: item?.code ?? code,
          scannedQty: result.scanned_qty_for_item,
          expectedQty: result.expected_qty_for_item,
          matchStatus: result.match_status,
        })
        if (!result.already_recorded) {
          const event: ScanEvent = {
            id: result.event_id,
            container_id: containerId!,
            container_item_id: result.container_item_id,
            code_raw: code.trim(),
            code_normalized: result.code_normalized,
            event_type: 'scan',
            delta,
            undoes_event_id: null,
            method,
            confidence: extra.confidence ?? null,
            corrected: extra.corrected ?? false,
            photo_path: null,
            match_status: result.match_status,
            client_event_id: result.event_id,
            created_by: profile?.id ?? '',
            created_at: new Date().toISOString(),
          }
          appendLocalEvent(event)
        }
        playBeep(result.match_status === 'over')
      } else {
        setLastScan({
          productName: t('activeScreen.lastScan.unknownProduct'),
          calidad: null,
          code,
          scannedQty: null,
          expectedQty: null,
          matchStatus: 'unknown',
        })
        await reloadUnknownCodesOnly()
        playBeep(true)
      }

      setCodeInput('')
      setPendingOver(null)
      setPendingDuplicate(null)
      setPhotoOn(false)
      inputRef.current?.focus()
    },
    [recordScan, items, containerId, profile?.id, appendLocalEvent, reloadUnknownCodesOnly, t]
  )

  const handleBarcodeDetect = useCallback((code: string) => submitScan(code, 1, 'barcode'), [submitScan])
  const handleUsbScan = useCallback((code: string) => submitScan(code, 1, 'usb_scanner'), [submitScan])

  const handleOcrConfirm = useCallback(
    async (result: OcrCaptureResult) => {
      await submitScan(result.code, 1, 'ocr', {
        confidence: result.confidence,
        corrected: result.corrected,
        photoBlob: settings.photo_archive_enabled ? result.photoBlob : null,
      })
    },
    [settings.photo_archive_enabled, submitScan]
  )

  if (loading) return <p className="text-sm text-slate-400">{t('activeScreen.loading')}</p>
  if (error || !container) return <p className="text-sm text-red-600">{error ?? t('activeScreen.notFound')}</p>

  const pendingUnknown = unknownCodes.filter((u) => u.status === 'pending' || u.status === 'review_later')

  async function handleUndoLast() {
    const lastScanEvent = [...events].reverse().find((e) => e.event_type === 'scan' && !events.some((u) => u.undoes_event_id === e.id))
    if (!lastScanEvent) return
    const { error, localEvent } = await undoScan(lastScanEvent, 'Deshacer último escaneo')
    if (error) {
      setScanError(error)
      return
    }
    if (localEvent) appendLocalEvent(localEvent)
    setLastScan(null)
  }

  async function handleStartCounting() {
    setStarting(true)
    const { error } = await supabase.rpc('set_container_status', {
      p_container_id: containerId!,
      p_new_status: 'counting',
    })
    setStarting(false)
    if (error) {
      setScanError(error.message)
      return
    }
    setContainerStatusLocal('counting')
    await reload()
  }

  async function handleComplete(override: boolean) {
    setCompleting(true)
    setCompleteError(null)
    const { error } = await supabase.rpc('set_container_status', {
      p_container_id: containerId!,
      p_new_status: 'completed',
      p_override_mismatch: override,
      p_reason: override ? completeReason.trim() : null,
    })
    setCompleting(false)
    if (error) {
      setCompleteError(error.message)
      return
    }
    setCompleteOpen(false)
    setContainerStatusLocal('completed')
    await reload()
  }

  async function handleReopen() {
    const { error } = await supabase.rpc('set_container_status', {
      p_container_id: containerId!,
      p_new_status: 'counting',
    })
    if (error) {
      setScanError(error.message)
      return
    }
    setContainerStatusLocal('counting')
    await reload()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{container.internal_number}</h1>
          <p className="text-sm text-slate-500">{container.code}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/contenedores/activo')}>
          {t('activeScreen.back')}
        </Button>
      </div>

      {pendingCount > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <CloudUpload size={14} className="animate-pulse" />
          {t('activeScreen.pendingSync', { count: pendingCount })}
        </div>
      )}

      <div className="mt-6">
        <ContainerSummaryHeader totals={totals} />
      </div>

      {(container.status === 'draft' || container.status === 'importing') && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>{t('activeScreen.notCounting')}</p>
          {canManage && (
            <Button className="mt-3" onClick={handleStartCounting} disabled={starting || totals.itemsTotal === 0}>
              {starting ? t('activeScreen.starting') : t('activeScreen.startCounting')}
            </Button>
          )}
        </div>
      )}

      {container.status === 'counting' && (
        <div className="mt-6 space-y-4">
          <UsbScannerInput active onScan={handleUsbScan} />

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">{t('activeScreen.scanTitle')}</p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPhotoOn(false)
                    setCameraOn((v) => !v)
                  }}
                >
                  <Camera size={16} /> {cameraOn ? t('activeScreen.closeCamera') : t('activeScreen.useCamera')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCameraOn(false)
                    setPhotoOn((v) => !v)
                  }}
                >
                  <ImagePlus size={16} /> {t('activeScreen.photo')}
                </Button>
              </div>
            </div>

            {cameraOn && (
              <div className="mt-3">
                <BarcodeScannerPanel active={cameraOn} onDetect={handleBarcodeDetect} />
              </div>
            )}

            {photoOn && (
              <div className="mt-3">
                <PhotoOcrCapture
                  confidenceThreshold={settings.ocr_confidence_threshold}
                  onConfirm={handleOcrConfirm}
                  onCancel={() => setPhotoOn(false)}
                />
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <input
                ref={inputRef}
                autoFocus
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitScan(codeInput, 1, 'manual')
                }}
                placeholder={t('activeScreen.codePlaceholder')}
                className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-3 py-3 text-lg focus:border-slate-500 focus:outline-none"
                disabled={submitting}
              />
              <Button onClick={() => submitScan(codeInput, 1, 'manual')} disabled={submitting || !codeInput.trim()}>
                +1
              </Button>
              <Button variant="secondary" onClick={() => submitScan(codeInput, 5, 'manual')} disabled={submitting || !codeInput.trim()}>
                +5
              </Button>
            </div>
            {scanError && (
              <p className="mt-2 flex items-center gap-1 text-sm text-red-600">
                <AlertTriangle size={14} /> {scanError}
              </p>
            )}
          </div>

          {lastScan && (
            <div
              className={`rounded-lg border p-4 ${
                lastScan.matchStatus === 'unknown'
                  ? 'border-orange-300 bg-orange-50'
                  : lastScan.matchStatus === 'over'
                    ? 'border-red-300 bg-red-50'
                    : lastScan.scannedQty === lastScan.expectedQty
                      ? 'border-green-300 bg-green-50'
                      : 'border-amber-300 bg-amber-50'
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('activeScreen.lastScan.title')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{lastScan.productName}</p>
              <p className="text-sm text-slate-600">
                {lastScan.calidad ? `${lastScan.calidad} — ` : ''}
                {lastScan.code}
              </p>
              {lastScan.scannedQty !== null && lastScan.expectedQty !== null && (
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {lastScan.scannedQty} / {lastScan.expectedQty}
                  {lastScan.matchStatus === 'over' && (
                    <span className="ml-2 text-red-600">
                      {t('activeScreen.lastScan.over', { count: lastScan.scannedQty - lastScan.expectedQty })}
                    </span>
                  )}
                  {lastScan.matchStatus === 'matched' && lastScan.scannedQty === lastScan.expectedQty && (
                    <span className="ml-2 text-green-700">{t('activeScreen.lastScan.complete')}</span>
                  )}
                </p>
              )}
              {lastScan.matchStatus === 'unknown' && <p className="mt-1 text-sm text-orange-700">{t('activeScreen.lastScan.unknownNote')}</p>}
            </div>
          )}

          <Button variant="ghost" onClick={handleUndoLast}>
            <Undo2 size={14} /> {t('activeScreen.undoLast')}
          </Button>

          {pendingUnknown.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-medium text-orange-800">{t('activeScreen.unknownBanner', { count: pendingUnknown.length })}</p>
              <ul className="mt-2 space-y-1">
                {pendingUnknown.map((u) => (
                  <li key={u.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-orange-900">
                      {u.first_raw_code} <span className="text-orange-600">({u.scan_count}x)</span>
                    </span>
                    {canManage && (
                      <button onClick={() => setResolveTarget(u)} className="font-medium text-orange-700 hover:underline">
                        {t('activeScreen.resolve')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canManage && (
            <div>
              <Button onClick={() => setCompleteOpen(true)}>{t('activeScreen.completeButton')}</Button>
            </div>
          )}
        </div>
      )}

      {container.status === 'completed' && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p>{t('activeScreen.completedBanner')}</p>
          {canManage && (
            <Button variant="secondary" className="mt-3" onClick={handleReopen}>
              {t('activeScreen.reopen')}
            </Button>
          )}
        </div>
      )}

      <ItemComparisonTable items={itemsWithProgress} />

      <Modal open={completeOpen} onClose={() => setCompleteOpen(false)} title={t('activeScreen.completeModal.title')}>
        <div className="space-y-4">
          {totals.hasMismatch ? (
            <>
              <p className="text-sm text-amber-700">{t('activeScreen.completeModal.mismatchWarning')}</p>
              <Textarea
                label={t('activeScreen.completeModal.reasonLabel')}
                rows={3}
                value={completeReason}
                onChange={(e) => setCompleteReason(e.target.value)}
              />
              {completeError && <p className="text-sm text-red-600">{completeError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
                  {t('newContainer.headerSelect.cancel')}
                </Button>
                <Button variant="danger" onClick={() => handleComplete(true)} disabled={completing || !completeReason.trim()}>
                  {completing ? t('activeScreen.completeModal.processing') : t('activeScreen.completeModal.confirmWithDiff')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">{t('activeScreen.completeModal.okQuestion')}</p>
              {completeError && <p className="text-sm text-red-600">{completeError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
                  {t('newContainer.headerSelect.cancel')}
                </Button>
                <Button onClick={() => handleComplete(false)} disabled={completing}>
                  {completing ? t('activeScreen.completeModal.processing') : t('activeScreen.completeModal.confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!pendingOver} onClose={() => setPendingOver(null)} title={t('activeScreen.overModal.title')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('activeScreen.overModal.message')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingOver(null)}>
              {t('newContainer.headerSelect.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                pendingOver && submitScan(pendingOver.code, pendingOver.delta, pendingOver.method, { ...pendingOver.extra, confirmOver: true })
              }
            >
              {t('activeScreen.overModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!pendingDuplicate} onClose={() => setPendingDuplicate(null)} title={t('activeScreen.duplicateModal.title')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('activeScreen.duplicateModal.message', { seconds: (settings.duplicate_scan_window_ms / 1000).toFixed(1) })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingDuplicate(null)}>
              {t('newContainer.headerSelect.cancel')}
            </Button>
            <Button
              onClick={() =>
                pendingDuplicate &&
                submitScan(pendingDuplicate.code, pendingDuplicate.delta, pendingDuplicate.method, {
                  ...pendingDuplicate.extra,
                  confirmDuplicate: true,
                })
              }
            >
              {t('activeScreen.duplicateModal.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <UnknownCodeResolveDialog
        open={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        unknownCode={resolveTarget}
        containerItems={items}
        onResolve={async (action, payload) => {
          if (!resolveTarget || !containerId) return { error: 'Sin selección' }
          const { error } = await resolveUnknownCode(containerId, resolveTarget.code_normalized, action, payload)
          if (!error) {
            await reload()
          }
          return { error }
        }}
      />
    </div>
  )
}

function playBeep(isError: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = isError ? 220 : 880
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => ctx.close()
  } catch {
    // audio not available (e.g. no user gesture yet) — silently skip
  }
}
