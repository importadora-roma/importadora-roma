import jsPDF from 'jspdf'
import { getLogoDataUrl, BRAND_NAVY, BRAND_GOLD } from '@/lib/pdf'
import { getVisibleChapters, type GuideChapter } from './userGuideContent'
import type { UserRole } from '@/types/models'

const roleLabels: Record<UserRole, { es: string; tr: string }> = {
  admin: { es: 'Admin', tr: 'Admin' },
  supervisor: { es: 'Supervisor', tr: 'Supervisor' },
  vendedor: { es: 'Vendedor', tr: 'Satış Elemanı' },
}

const MARGIN_X = 14
const CONTENT_WIDTH = 182
const PAGE_BOTTOM = 280
const PAGE_TOP = 22

interface TocEntry {
  text: string
  page: number
  isPart: boolean
}

// jsPDF's built-in Helvetica only supports WinAnsiEncoding, which is
// missing ş/ğ/ı/İ — Turkish text renders as garbage without a real font.
// Roboto (Latin + Latin Extended-A) covers both Spanish and Turkish, so the
// whole document uses it instead of switching fonts mid-document.
let fontPromise: Promise<{ regular: string; bold: string } | null> | null = null

async function fetchFontBase64(path: string): Promise<string | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null
        resolve(result ? result.split(',')[1] : null)
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function loadFonts(): Promise<{ regular: string; bold: string } | null> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const [regular, bold] = await Promise.all([fetchFontBase64('/fonts/Roboto-Regular.ttf'), fetchFontBase64('/fonts/Roboto-Bold.ttf')])
      return regular && bold ? { regular, bold } : null
    })()
  }
  return fontPromise
}

function addFooter(doc: jsPDF, font: string, page: number, totalPages: number) {
  doc.setPage(page)
  doc.setFont(font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text('Importadora Roma — Manual de Usuario / Kullanım Kılavuzu', MARGIN_X, 291)
  doc.text(`${page - 1} / ${totalPages - 1}`, 196, 291, { align: 'right' })
  doc.setTextColor(0)
}

function renderChapters(doc: jsPDF, font: string, chapters: GuideChapter[], lang: 'es' | 'tr', toc: TocEntry[], partTitle: string): void {
  doc.addPage()
  let y = PAGE_TOP

  doc.setFont(font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...BRAND_NAVY)
  doc.text(partTitle, MARGIN_X, y)
  toc.push({ text: partTitle, page: doc.internal.pages.length - 1, isPart: true })
  y += 12
  doc.setTextColor(0)

  chapters.forEach((chapter, idx) => {
    const title = lang === 'es' ? chapter.titleEs : chapter.titleTr
    const body = lang === 'es' ? chapter.bodyEs : chapter.bodyTr

    if (y > PAGE_BOTTOM - 20) {
      doc.addPage()
      y = PAGE_TOP
    }

    doc.setFont(font, 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...BRAND_NAVY)
    const heading = `${idx + 1}. ${title}`
    doc.text(heading, MARGIN_X, y)
    toc.push({ text: heading, page: doc.internal.pages.length - 1, isPart: false })
    y += 5
    doc.setDrawColor(...BRAND_GOLD)
    doc.setLineWidth(0.4)
    doc.line(MARGIN_X, y, MARGIN_X + 40, y)
    doc.setDrawColor(0)
    y += 6

    doc.setFont(font, 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40)

    body.forEach((paragraph) => {
      const lines = doc.splitTextToSize(paragraph, CONTENT_WIDTH) as string[]
      lines.forEach((line) => {
        if (y > PAGE_BOTTOM) {
          doc.addPage()
          y = PAGE_TOP
        }
        doc.text(line, MARGIN_X, y)
        y += 5
      })
      y += 3.5
    })

    y += 5
  })

  doc.setTextColor(0)
}

export async function generateUserGuidePdf(role: UserRole, isTienda: boolean, branchName: string): Promise<void> {
  const chapters = getVisibleChapters(role, isTienda)
  const [logoDataUrl, fonts] = await Promise.all([getLogoDataUrl(), loadFonts()])
  const doc = new jsPDF()

  const font = fonts ? 'Roboto' : 'helvetica'
  if (fonts) {
    doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular)
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
    doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold)
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold')
  }

  const roleLabel = roleLabels[role]
  const today = new Date().toLocaleDateString('es-CL')

  // ---- Cover page ----
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', 75, 55, 60, 60)
  }
  doc.setFont(font, 'bold')
  doc.setFontSize(24)
  doc.setTextColor(...BRAND_NAVY)
  doc.text('Importadora Roma', 105, 135, { align: 'center' })

  doc.setFont(font, 'normal')
  doc.setFontSize(15)
  doc.setTextColor(60)
  doc.text('Manual de Usuario', 105, 148, { align: 'center' })
  doc.text('Kullanım Kılavuzu', 105, 157, { align: 'center' })

  doc.setDrawColor(...BRAND_GOLD)
  doc.setLineWidth(0.8)
  doc.line(65, 165, 145, 165)
  doc.setDrawColor(0)

  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`${branchName}  ·  ${roleLabel.es} / ${roleLabel.tr}`, 105, 176, { align: 'center' })
  doc.text(today, 105, 183, { align: 'center' })

  doc.setFontSize(8.5)
  doc.setTextColor(160)
  doc.text('Hecho por Deniz Semiz', 105, 280, { align: 'center' })
  doc.setTextColor(0)

  // ---- TOC placeholder page ----
  doc.addPage()

  // ---- Content ----
  const toc: TocEntry[] = []
  renderChapters(doc, font, chapters, 'es', toc, 'PARTE 1 — MANUAL EN ESPAÑOL')
  renderChapters(doc, font, chapters, 'tr', toc, 'BÖLÜM 2 — TÜRKÇE KILAVUZ')

  // ---- Fill in TOC on page 2 ----
  doc.setPage(2)
  let ty = PAGE_TOP
  doc.setFont(font, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...BRAND_NAVY)
  doc.text('Contenido / İçindekiler', MARGIN_X, ty)
  ty += 6
  doc.setDrawColor(...BRAND_GOLD)
  doc.setLineWidth(0.6)
  doc.line(MARGIN_X, ty, 196, ty)
  doc.setDrawColor(0)
  ty += 10

  toc.forEach((entry) => {
    if (entry.isPart) {
      ty += 3
      doc.setFont(font, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...BRAND_NAVY)
      doc.text(entry.text, MARGIN_X, ty)
      doc.setTextColor(0)
      ty += 8
    } else {
      doc.setFont(font, 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(50)
      const dots = '.'.repeat(Math.max(0, 70 - entry.text.length))
      doc.text(`${entry.text} ${dots} ${entry.page - 1}`, MARGIN_X + 4, ty)
      doc.setTextColor(0)
      ty += 6
    }
  })

  // ---- Footers ----
  const finalTotal = doc.internal.pages.length - 1
  for (let p = 2; p <= finalTotal; p++) {
    addFooter(doc, font, p, finalTotal)
  }

  doc.save(`manual-usuario-importadora-roma-${role}.pdf`)
}
