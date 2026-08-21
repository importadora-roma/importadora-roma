// Barcode scanning: uses the native Barcode Detection API where the browser
// supports it (Chrome/Edge/Android — no extra bundle cost), and falls back
// to a dynamically-imported ZXing decoder everywhere else (Safari, Firefox,
// desktop) so the ~150KB ZXing bundle is only ever downloaded when actually
// needed.

export type BarcodeFormat = 'qr_code' | 'code_128' | 'code_39' | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'data_matrix'

const NATIVE_FORMATS: BarcodeFormat[] = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix']

interface DetectedBarcode {
  rawValue: string
}

interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => NativeBarcodeDetector
  }
}

export function isBarcodeScanningSupported(): boolean {
  return 'BarcodeDetector' in window || typeof navigator !== 'undefined'
}

export interface BarcodeScannerHandle {
  stop: () => void
}

// Starts continuous scanning against a <video> element that already has a
// camera stream attached, calling onDetect for every distinct decoded value.
// Caller is responsible for the getUserMedia stream lifecycle (see
// BarcodeScannerPanel.tsx) — this only owns the detection loop.
export async function startBarcodeScanner(
  video: HTMLVideoElement,
  onDetect: (code: string) => void
): Promise<BarcodeScannerHandle> {
  if (window.BarcodeDetector) {
    return startNativeScanner(video, window.BarcodeDetector, onDetect)
  }
  return startZXingScanner(video, onDetect)
}

function startNativeScanner(
  video: HTMLVideoElement,
  BarcodeDetectorCtor: NonNullable<Window['BarcodeDetector']>,
  onDetect: (code: string) => void
): BarcodeScannerHandle {
  const detector = new BarcodeDetectorCtor({ formats: NATIVE_FORMATS })
  let stopped = false

  async function loop() {
    if (stopped) return
    try {
      const results = await detector.detect(video)
      if (results.length > 0) onDetect(results[0].rawValue)
    } catch {
      // transient decode failure (e.g. video not ready yet) — keep looping
    }
    if (!stopped) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return {
    stop: () => {
      stopped = true
    },
  }
}

async function startZXingScanner(video: HTMLVideoElement, onDetect: (code: string) => void): Promise<BarcodeScannerHandle> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const reader = new BrowserMultiFormatReader()
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) onDetect(result.getText())
  })

  return {
    stop: () => controls.stop(),
  }
}
