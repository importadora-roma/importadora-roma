import { createPdfDoc, autoTable, getLogoDataUrl, BRAND_NAVY } from '@/lib/pdf'
import { formatCLP, formatDate, formatDateTime } from '@/lib/format'
import type { Quotation, QuotationItem } from './useQuotations'

export async function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
  context: {
    branchName: string
    branchAddress: string | null
    customerName: string | null
    variantLabel: (variantId: string) => string
  }
) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(
    `Cotización ${quotation.quotation_number ?? ''}`,
    formatDateTime(quotation.created_at),
    { logoDataUrl, branchName: context.branchName, branchAddress: context.branchAddress }
  )

  let y = contentY
  doc.setFontSize(9)
  doc.setTextColor(80)
  if (context.customerName) {
    doc.text(`Cliente: ${context.customerName}`, 14, y)
    y += 6
  }
  if (quotation.valid_until) {
    doc.text(`Válida hasta: ${formatDate(quotation.valid_until)}`, 14, y)
    y += 6
  }
  doc.setTextColor(0)

  autoTable(doc, {
    startY: y + 4,
    head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
    headStyles: { fillColor: BRAND_NAVY },
    body: items.map((i) => [context.variantLabel(i.variant_id), String(i.quantity), formatCLP(i.unit_price), formatCLP(i.line_total)]),
    foot: [['', '', 'Total', formatCLP(quotation.total)]],
    footStyles: { fillColor: [241, 245, 249], textColor: BRAND_NAVY, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  doc.save(`cotizacion-${quotation.quotation_number ?? quotation.id}.pdf`)
}
