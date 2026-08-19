import { createPdfDoc, autoTable } from '@/lib/pdf'
import { formatCLP, formatDate, formatDateTime } from '@/lib/format'
import type { Quotation, QuotationItem } from './useQuotations'

export function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
  context: { branchName: string; customerName: string | null; variantLabel: (variantId: string) => string }
) {
  const doc = createPdfDoc(
    `Cotización ${quotation.quotation_number ?? ''}`,
    `${context.branchName} · ${formatDateTime(quotation.created_at)}`
  )

  let y = 38
  if (context.customerName) {
    doc.setFontSize(9)
    doc.text(`Cliente: ${context.customerName}`, 14, y)
    y += 6
  }
  if (quotation.valid_until) {
    doc.setFontSize(9)
    doc.text(`Válida hasta: ${formatDate(quotation.valid_until)}`, 14, y)
    y += 6
  }

  autoTable(doc, {
    startY: y + 2,
    head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
    body: items.map((i) => [context.variantLabel(i.variant_id), String(i.quantity), formatCLP(i.unit_price), formatCLP(i.line_total)]),
    foot: [['', '', 'Total', formatCLP(quotation.total)]],
  })

  doc.save(`cotizacion-${quotation.quotation_number ?? quotation.id}.pdf`)
}
