import { useRef, useState } from 'react'
import { AlertTriangle, Camera, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { compressImage } from '@/lib/imageCompress'
import { hasAmbiguousChars, recognizeCode } from '@/lib/ocr'
import { useTranslation } from '@/i18n/I18nProvider'

export interface OcrCaptureResult {
  code: string
  confidence: number
  corrected: boolean
  photoBlob: Blob
}

// Photo → OCR → confidence check → mandatory manual correction below
// threshold (or when ambiguous characters like 0/O, 1/I/l, 5/S, 8/B are
// present) → confirm. Never auto-accepts a low-confidence reading.
export function PhotoOcrCapture({
  confidenceThreshold,
  onConfirm,
  onCancel,
}: {
  confidenceThreshold: number
  onConfirm: (result: OcrCaptureResult) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [processing, setProcessing] = useState(false)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [rawText, setRawText] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [editedCode, setEditedCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setProcessing(true)
    setError(null)
    try {
      const compressed = await compressImage(file)
      setPhotoBlob(compressed)
      const result = await recognizeCode(compressed)
      setRawText(result.text)
      setConfidence(result.confidence)
      setEditedCode(result.text)
    } catch {
      setError(t('photoOcr.error'))
    }
    setProcessing(false)
  }

  const needsCorrection = confidence < confidenceThreshold || hasAmbiguousChars(rawText)
  const wasCorrected = editedCode.trim() !== rawText.trim()

  function handleConfirm() {
    if (!photoBlob || !editedCode.trim()) return
    onConfirm({ code: editedCode.trim(), confidence, corrected: wasCorrected, photoBlob })
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{t('photoOcr.title')}</p>
        <Button variant="ghost" onClick={onCancel}>
          {t('newContainer.headerSelect.cancel')}
        </Button>
      </div>

      {!photoBlob && !processing && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Camera size={16} /> {t('photoOcr.takePhoto')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </div>
      )}

      {processing && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> {t('photoOcr.reading')}
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {photoBlob && !processing && !error && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            {t('photoOcr.confidence')}{' '}
            <span className={confidence < confidenceThreshold ? 'font-medium text-red-600' : 'font-medium text-green-600'}>
              {Math.round(confidence)}%
            </span>
          </p>

          {needsCorrection && (
            <p className="flex items-center gap-1 text-sm text-amber-700">
              <AlertTriangle size={14} /> {t('photoOcr.needsCorrection')}
            </p>
          )}

          <input
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-lg font-mono focus:border-slate-500 focus:outline-none"
          />

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPhotoBlob(null)}>
              {t('photoOcr.retake')}
            </Button>
            <Button onClick={handleConfirm} disabled={!editedCode.trim()}>
              {t('photoOcr.confirmCode')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
