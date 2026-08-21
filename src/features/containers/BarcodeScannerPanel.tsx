import { useEffect, useRef, useState } from 'react'
import { CameraOff } from 'lucide-react'
import { startBarcodeScanner, type BarcodeScannerHandle } from '@/lib/barcode'
import { useTranslation } from '@/i18n/I18nProvider'

// Continuous camera scan loop: opens the back camera, decodes barcodes/QR
// as they appear, and calls onDetect for each distinct value. The parent
// owns the anti-double-scan debounce (same code scanned repeatedly is
// expected — 120 identical fardo codes in a row is normal, per spec).
export function BarcodeScannerPanel({ onDetect, active }: { onDetect: (code: string) => void; active: boolean }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<BarcodeScannerHandle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        if (!videoRef.current || cancelled) return
        scannerRef.current = await startBarcodeScanner(videoRef.current, (code) => {
          if (!cancelled) onDetect(code)
        })
      } catch {
        if (!cancelled) setError(t('barcodeScanner.error'))
      }
    }
    start()

    return () => {
      cancelled = true
      scannerRef.current?.stop()
      scannerRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [active, onDetect, t])

  if (!active) return null

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-black">
      {error ? (
        <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-300">
          <CameraOff size={24} />
          {error}
        </div>
      ) : (
        <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      )}
    </div>
  )
}
