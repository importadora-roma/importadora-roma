import { createPdfDoc, autoTable, getLogoDataUrl } from '@/lib/pdf'
import { formatCLP, formatDate } from '@/lib/format'
import type { TransferItem } from '@/features/transfers/useTransfers'

export interface FurgonLoadEntry {
  items: TransferItem[]
}

// Simple consolidated summary of everything loaded onto the van in a date
// range — one row per product, quantity and value summed across every guía
// in the period. No per-guía breakdown: that repeated the same totals a
// second time further down the page, which read as if the quantities were
// double what was actually loaded.
export async function generateFurgonLoadsReportPdf(
  loads: FurgonLoadEntry[],
  context: { from: string; to: string; variantLabel: (variantId: string) => string }
) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(
    'Reporte de cargas al furgón',
    `${formatDate(`${context.from}T00:00:00`)} – ${formatDate(`${context.to}T00:00:00`)} · ${loads.length} guía${loads.length === 1 ? '' : 's'}`,
    { logoDataUrl }
  )

  if (loads.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text('No hubo cargas al furgón en este período.', 14, contentY)
    doc.save(`cargas-furgon-${context.from}-a-${context.to}.pdf`)
    return
  }

  const summaryByVariant = new Map<string, { label: string; quantity: number; value: number }>()
  for (const load of loads) {
    for (const item of load.items) {
      const entry = summaryByVariant.get(item.variant_id) ?? { label: context.variantLabel(item.variant_id), quantity: 0, value: 0 }
      entry.quantity += item.quantity
      entry.value += (item.unit_price ?? 0) * item.quantity
      summaryByVariant.set(item.variant_id, entry)
    }
  }
  const summaryRows = Array.from(summaryByVariant.values()).sort((a, b) => b.quantity - a.quantity)
  const grandTotal = summaryRows.reduce((s, r) => s + r.value, 0)
  const grandQuantity = summaryRows.reduce((s, r) => s + r.quantity, 0)

  autoTable(doc, {
    startY: contentY,
    head: [['Producto', 'Cantidad', 'Valor total']],
    body: summaryRows.map((r) => [r.label, String(r.quantity), formatCLP(r.value)]),
    foot: [['Total', String(grandQuantity), formatCLP(grandTotal)]],
  })

  doc.save(`cargas-furgon-${context.from}-a-${context.to}.pdf`)
}
