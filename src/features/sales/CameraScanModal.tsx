import { useEffect, useRef, useState } from 'react'
import { CameraOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { startBarcodeScanner, type BarcodeScannerHandle } from '@/lib/barcode'

// Reuses the same camera + BarcodeDetector/ZXing pipeline built for
// Contenedores (src/lib/barcode.ts) so phones without a USB scanner can
// still scan a fardo's printed label straight into the sale/quote/transfer.
export function CameraScanModal({ open, onClose, onDetect }: { open: boolean; onClose: () => void; onDetect: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<BarcodeScannerHandle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    let cancelled = false
    let detected = false

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
          if (cancelled || detected) return
          detected = true
          onDetect(code)
        })
      } catch {
        if (!cancelled) setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.')
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
  }, [open, onDetect])

  return (
    <Modal open={open} onClose={onClose} title="Escanear código de barras">
      <div className="space-y-3">
        {error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-900 p-8 text-center text-sm text-slate-300">
            <CameraOff size={24} />
            {error}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-black">
            <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          </div>
        )}
        <p className="text-center text-xs text-slate-400">Apunta la cámara al código de barras de la etiqueta.</p>
      </div>
    </Modal>
  )
}
