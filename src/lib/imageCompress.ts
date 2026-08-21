// Downscales + re-encodes a photo before OCR (faster recognition) and
// before archiving to Storage (keeps per-photo cost small — spec explicitly
// warns against storing unnecessarily large label photos).
export async function compressImage(file: Blob, maxWidth = 1280, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxWidth / bitmap.width)
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality)
  })
}
