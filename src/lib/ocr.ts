import { createWorker, type Worker } from 'tesseract.js'

export interface OcrResult {
  text: string
  confidence: number // 0-100
}

let workerPromise: Promise<Worker> | null = null

// Lazily created once and reused across scans — spinning up a Tesseract
// worker (loads the wasm core + language data) takes a couple seconds, far
// too slow to redo per photo.
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng')
  }
  return workerPromise
}

// Recognizes a fardo code from a photo. Never auto-corrects ambiguous
// characters (0/O, 1/I/l, 5/S, 8/B) itself — returns the raw OCR text and
// confidence; ambiguity handling and the manual-correction UI live in
// PhotoOcrCapture.tsx, which is where the confidence threshold is applied.
export async function recognizeCode(image: Blob | HTMLCanvasElement | string): Promise<OcrResult> {
  const worker = await getWorker()
  const {
    data: { text, confidence },
  } = await worker.recognize(image)
  return { text: text.trim(), confidence }
}

// Ambiguous OCR character pairs commonly confused on printed labels —
// surfaced to the UI to highlight, never silently substituted (spec: never
// auto-correct into a possibly-wrong match).
export const AMBIGUOUS_CHAR_PAIRS: [string, string][] = [
  ['0', 'O'],
  ['1', 'I'],
  ['1', 'l'],
  ['5', 'S'],
  ['8', 'B'],
]

export function hasAmbiguousChars(text: string): boolean {
  return [...text].some((ch) => AMBIGUOUS_CHAR_PAIRS.some(([a, b]) => ch === a || ch === b))
}
