import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeCode } from '@/lib/codeNormalize'
import { enqueueScan, enqueueUndo, flushQueue, getPendingCount, isNetworkError } from '@/lib/offlineQueue'
import type { ScanMatchStatus, ScanMethod } from '@/types/database'
import type { ItemWithProgress, ScanEvent } from './types'

// Server-side sentinel record_scan raises when a scan would push an item's
// scanned quantity over its expected_qty and container_settings.block_over_scan
// is on — the client catches this exact message to show a confirm dialog
// instead of a generic error, then retries once with confirmOver: true.
export const OVER_EXPECTED_ERROR = 'over_expected_confirmation_required'

export interface RecordScanResult {
  event_id: string
  match_status: ScanMatchStatus
  container_item_id: string | null
  code_normalized: string
  scanned_qty_for_item: number | null
  expected_qty_for_item: number | null
  already_recorded: boolean
}

export interface RecordScanOptions {
  delta?: number
  confidence?: number | null
  corrected?: boolean
  photoBlob?: Blob | null
  deviceInfo?: Record<string, unknown> | null
  confirmOver?: boolean
  // Bypasses the duplicate-scan warning for manual/usb_scanner methods —
  // set after the operator confirms the "already scanned recently" dialog.
  confirmDuplicate?: boolean
}

export interface ScanOutcome {
  result: RecordScanResult | null
  error: string | null
  overExpected: boolean
  // Camera/OCR: the same code is still in frame/photo — silently ignored,
  // no dialog, no RPC call (this is the expected, common case for those
  // sources, not a mistake to flag).
  debouncedSilently: boolean
  // Manual/USB scanner: the exact same code arrived again within the
  // configured window — surfaced to the operator to confirm before it's
  // recorded again (spec: "¿Tekrar saymak istediğinize emin misiniz?").
  needsDuplicateConfirm: boolean
  // Saved to the local offline queue instead of the server — still fully
  // reflected in the UI (result is populated from local state), will sync
  // automatically once connectivity returns.
  queued: boolean
}

// Wraps record_scan/undo_scan with an IndexedDB-backed offline queue: while
// there's no connection, scans are resolved against the container's current
// local state (itemsWithProgress) and queued instead of failing outright;
// they sync automatically on reconnect via client_event_id idempotency, so
// a scan captured offline can never double-count once it reaches the server.
export function useContainerScanning(
  containerId: string,
  duplicateScanWindowMs: number,
  itemsWithProgress: ItemWithProgress[],
  onFlushed?: () => void
) {
  const [submitting, setSubmitting] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const lastScanAtByCode = useRef(new Map<string, number>())
  const itemsRef = useRef(itemsWithProgress)
  useEffect(() => {
    itemsRef.current = itemsWithProgress
  }, [itemsWithProgress])

  const refreshPendingCount = useCallback(async () => {
    setPendingCount(await getPendingCount())
  }, [])

  const flush = useCallback(async () => {
    if (!navigator.onLine) return
    const { synced } = await flushQueue()
    await refreshPendingCount()
    if (synced > 0) onFlushed?.()
  }, [refreshPendingCount, onFlushed])

  useEffect(() => {
    refreshPendingCount()
    flush()
    const interval = setInterval(flush, 20000)
    window.addEventListener('online', flush)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', flush)
    }
  }, [flush, refreshPendingCount])

  async function resolveLocally(
    normalized: string,
    delta: number,
    confirmOver: boolean
  ): Promise<{ blocked: boolean; result: RecordScanResult; item: ItemWithProgress | undefined }> {
    const item = itemsRef.current.find((i) => i.code_normalized === normalized)
    let matchStatus: ScanMatchStatus
    let scannedAfter: number | null = null

    if (!item) {
      matchStatus = 'unknown'
    } else {
      scannedAfter = item.scannedQty + delta
      if (scannedAfter > item.expected_qty) {
        if (!confirmOver) {
          return { blocked: true, result: null as never, item }
        }
        matchStatus = 'over'
      } else {
        matchStatus = 'matched'
      }
    }

    return {
      blocked: false,
      item,
      result: {
        event_id: crypto.randomUUID(),
        match_status: matchStatus,
        container_item_id: item?.id ?? null,
        code_normalized: normalized,
        scanned_qty_for_item: scannedAfter,
        expected_qty_for_item: item?.expected_qty ?? null,
        already_recorded: false,
      },
    }
  }

  async function recordScan(codeRaw: string, method: ScanMethod, options: RecordScanOptions = {}): Promise<ScanOutcome> {
    const normalized = normalizeCode(codeRaw)
    const now = Date.now()
    const lastAt = lastScanAtByCode.current.get(normalized)
    const withinWindow = lastAt !== undefined && now - lastAt < duplicateScanWindowMs

    if (withinWindow) {
      if (method === 'barcode' || method === 'ocr') {
        return { result: null, error: null, overExpected: false, debouncedSilently: true, needsDuplicateConfirm: false, queued: false }
      }
      if ((method === 'manual' || method === 'usb_scanner') && !options.confirmDuplicate) {
        return { result: null, error: null, overExpected: false, debouncedSilently: false, needsDuplicateConfirm: true, queued: false }
      }
    }

    const delta = options.delta ?? 1
    const clientEventId = crypto.randomUUID()

    if (navigator.onLine) {
      setSubmitting(true)
      let photoPath: string | null = null
      if (options.photoBlob) {
        const path = `${containerId}/${clientEventId}.jpg`
        const { error: uploadError } = await supabase.storage.from('container-photos').upload(path, options.photoBlob, {
          contentType: 'image/jpeg',
        })
        if (!uploadError) photoPath = path
      }

      const { data, error } = await supabase.rpc('record_scan', {
        p_container_id: containerId,
        p_client_event_id: clientEventId,
        p_code_raw: codeRaw,
        p_method: method,
        p_delta: delta,
        p_confidence: options.confidence ?? null,
        p_corrected: options.corrected ?? false,
        p_photo_path: photoPath,
        p_device_info: options.deviceInfo ?? null,
        p_client_scanned_at: new Date().toISOString(),
        p_confirm_over: options.confirmOver ?? false,
      })
      setSubmitting(false)

      if (!error) {
        lastScanAtByCode.current.set(normalized, now)
        return { result: data as unknown as RecordScanResult, error: null, overExpected: false, debouncedSilently: false, needsDuplicateConfirm: false, queued: false }
      }
      if (error.message.includes(OVER_EXPECTED_ERROR)) {
        return { result: null, error: null, overExpected: true, debouncedSilently: false, needsDuplicateConfirm: false, queued: false }
      }
      if (!isNetworkError(error.message)) {
        return { result: null, error: error.message, overExpected: false, debouncedSilently: false, needsDuplicateConfirm: false, queued: false }
      }
      // network error: fall through to offline queuing below
    }

    const { blocked, result, item } = await resolveLocally(normalized, delta, options.confirmOver ?? false)
    if (blocked) {
      return { result: null, error: null, overExpected: true, debouncedSilently: false, needsDuplicateConfirm: false, queued: false }
    }
    void item

    await enqueueScan({
      clientEventId,
      containerId,
      codeRaw,
      method,
      delta,
      confidence: options.confidence ?? null,
      corrected: options.corrected ?? false,
      confirmOver: options.confirmOver ?? false,
      deviceInfo: options.deviceInfo ?? null,
      clientScannedAt: new Date().toISOString(),
      photoBlob: options.photoBlob ?? null,
    })
    lastScanAtByCode.current.set(normalized, now)
    await refreshPendingCount()

    return { result: { ...result, event_id: clientEventId }, error: null, overExpected: false, debouncedSilently: false, needsDuplicateConfirm: false, queued: true }
  }

  async function undoScan(original: ScanEvent, reason?: string): Promise<{ error: string | null; localEvent: ScanEvent | null }> {
    const clientEventId = crypto.randomUUID()

    if (navigator.onLine) {
      setSubmitting(true)
      const { error } = await supabase.rpc('undo_scan', {
        p_scan_event_id: original.id,
        p_client_event_id: clientEventId,
        p_reason: reason ?? null,
      })
      setSubmitting(false)

      if (!error) {
        return { error: null, localEvent: buildNegatingEvent(original, clientEventId) }
      }
      if (!isNetworkError(error.message)) {
        return { error: error.message, localEvent: null }
      }
    }

    await enqueueUndo({ clientEventId, scanEventId: original.id, reason: reason ?? null })
    await refreshPendingCount()
    return { error: null, localEvent: buildNegatingEvent(original, clientEventId) }
  }

  return { recordScan, undoScan, submitting, pendingCount, flush }
}

function buildNegatingEvent(original: ScanEvent, clientEventId: string): ScanEvent {
  return {
    id: clientEventId,
    container_id: original.container_id,
    container_item_id: original.container_item_id,
    code_raw: original.code_raw,
    code_normalized: original.code_normalized,
    event_type: 'undo',
    delta: -original.delta,
    undoes_event_id: original.id,
    method: original.method,
    confidence: null,
    corrected: false,
    photo_path: null,
    match_status: original.match_status,
    client_event_id: clientEventId,
    created_by: original.created_by,
    created_at: new Date().toISOString(),
  }
}
