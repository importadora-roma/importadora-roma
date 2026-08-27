import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const COMPANY_NAME = 'Importadora Roma'

// Sampled from public/pwa-512.png (the Comercial Decoline badge) so PDF
// headers/charts match the brand instead of jsPDF's default black.
export const BRAND_NAVY: [number, number, number] = [16, 29, 58]
export const BRAND_GOLD: [number, number, number] = [200, 163, 85]

let logoDataUrlPromise: Promise<string | null> | null = null

// Fetched once per session and cached — PDF generation must never fail just
// because the logo couldn't load, so every caller gets null on any error
// instead of a thrown exception.
export function getLogoDataUrl(): Promise<string | null> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = (async () => {
      try {
        const res = await fetch('/pwa-512.png')
        if (!res.ok) return null
        const blob = await res.blob()
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    })()
  }
  return logoDataUrlPromise
}

export function createPdfDoc(title: string, subtitle?: string, options?: { logoDataUrl?: string | null }) {
  const doc = new jsPDF()
  const hasLogo = !!options?.logoDataUrl
  const textX = hasLogo ? 34 : 14

  if (hasLogo && options?.logoDataUrl) {
    doc.addImage(options.logoDataUrl, 'PNG', 14, 9, 16, 16)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...BRAND_NAVY)
  doc.text(COMPANY_NAME, textX, 16)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(30)
  doc.text(title, textX, 23)

  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(subtitle, textX, 29)
  }

  doc.setDrawColor(...BRAND_GOLD)
  doc.setLineWidth(0.6)
  doc.line(14, 33, 196, 33)
  doc.setTextColor(0)
  doc.setDrawColor(0)
  doc.setLineWidth(0.2)

  return doc
}

interface PieSlice {
  label: string
  value: number
  color: [number, number, number]
}

// Renders a pie chart to an offscreen canvas and returns it as a PNG data
// URL — jsPDF has no native chart support, but doc.addImage() takes any
// image, so drawing with the browser's own Canvas 2D API avoids pulling in
// a charting dependency just for this.
export function renderPieChartImage(slices: PieSlice[], size = 400): string | null {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 4

  let angle = -Math.PI / 2
  for (const slice of slices) {
    const sliceAngle = (slice.value / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, radius, angle, angle + sliceAngle)
    ctx.closePath()
    ctx.fillStyle = `rgb(${slice.color[0]}, ${slice.color[1]}, ${slice.color[2]})`
    ctx.fill()
    angle += sliceAngle
  }

  // Donut hole so the chart reads as a modern ring rather than a flat pie.
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  return canvas.toDataURL('image/png')
}

// Draws a pie chart plus a color-swatch legend at the given position and
// returns the y-coordinate immediately below whichever is taller, so the
// caller can keep stacking content without hardcoding heights.
export function addPieChartWithLegend(
  doc: jsPDF,
  x: number,
  y: number,
  slices: PieSlice[],
  formatValue: (n: number) => string,
  chartSizeMm = 40
): number {
  const filtered = slices.filter((s) => s.value > 0)
  const image = renderPieChartImage(filtered)
  if (!image) {
    doc.setFontSize(9)
    doc.setTextColor(150)
    doc.text('Sin datos en este período', x, y + chartSizeMm / 2)
    doc.setTextColor(0)
    return y + chartSizeMm / 2 + 8
  }

  doc.addImage(image, 'PNG', x, y, chartSizeMm, chartSizeMm)

  const legendX = x + chartSizeMm + 8
  let legendY = y + 4
  const total = filtered.reduce((s, sl) => s + sl.value, 0)
  doc.setFontSize(9)
  for (const slice of filtered) {
    doc.setFillColor(...slice.color)
    doc.rect(legendX, legendY - 3, 3.5, 3.5, 'F')
    doc.setTextColor(30)
    const pct = total > 0 ? ` (${((slice.value / total) * 100).toFixed(0)}%)` : ''
    doc.text(`${slice.label}: ${formatValue(slice.value)}${pct}`, legendX + 6, legendY)
    legendY += 6
  }
  doc.setTextColor(0)

  return y + Math.max(chartSizeMm, legendY - y) + 8
}

export { autoTable }
