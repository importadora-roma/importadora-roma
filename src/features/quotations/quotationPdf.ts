import { createPdfDoc, autoTable, getLogoDataUrl, BRAND_NAVY } from '@/lib/pdf'
import { formatCLP, formatDate, formatDateTime } from '@/lib/format'
import type { Quotation, QuotationItem } from './useQuotations'

interface QuotationCustomer {
  name: string
  rut: string | null
  address: string | null
  phone: string | null
}

export async function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
  context: {
    branchName: string
    branchAddress: string | null
    customer: QuotationCustomer | null
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
  if (context.customer) {
    doc.text(`Cliente: ${context.customer.name}`, 14, y)
    y += 5
    if (context.customer.rut) {
      doc.text(`RUT: ${context.customer.rut}`, 14, y)
      y += 5
    }
    if (context.customer.address) {
      doc.text(`Dirección: ${context.customer.address}`, 14, y)
      y += 5
    }
    if (context.customer.phone) {
      doc.text(`Teléfono: ${context.customer.phone}`, 14, y)
      y += 5
    }
    y += 1
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

  if (quotation.notes) {
    const notesY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    doc.setFontSize(9)
    doc.setTextColor(80)
    doc.text('Notas:', 14, notesY)
    doc.text(doc.splitTextToSize(quotation.notes, 180), 14, notesY + 5)
    doc.setTextColor(0)
  }

  doc.save(`cotizacion-${quotation.quotation_number ?? quotation.id}.pdf`)
}
