import { createPdfDoc, autoTable, getLogoDataUrl } from '@/lib/pdf'
import { formatCLP, formatDate } from '@/lib/format'
import type { Sale, SaleItem, SalePayment } from './useSales'
import type { SalePaymentMethod } from '@/types/database'

const paymentLabels: Record<SalePaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
}

interface SaleCustomer {
  name: string
  rut: string | null
  address: string | null
  phone: string | null
}

interface SaleCreditInfo {
  creditAmount: number
  paidAmount: number
  remaining: number
  dueDate: string | null
}

export async function generateSalePdf(
  sale: Sale,
  items: SaleItem[],
  payments: SalePayment[],
  context: {
    branchName: string
    branchAddress: string | null
    customer: SaleCustomer | null
    credit?: SaleCreditInfo | null
    variantLabel: (variantId: string) => string
  }
) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(`Comprobante de venta ${sale.sale_number ?? ''}`, formatDate(`${sale.sale_date}T00:00:00`), {
    logoDataUrl,
    branchName: context.branchName,
    branchAddress: context.branchAddress,
  })

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
  doc.setTextColor(0)

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
    body: items
      .filter((i) => i.status !== 'cancelled')
      .flatMap((i) => {
        const row = [
          `${i.custom_name ?? context.variantLabel(i.variant_id!)}${i.status === 'returned' ? ' (cambiado)' : ''}`,
          String(i.quantity),
          formatCLP(i.sold_price),
          formatCLP(i.line_total),
        ]
        if (!i.notes) return [row]
        return [
          row,
          [{ content: `Nota: ${i.notes}`, colSpan: 4, styles: { fontSize: 7, textColor: [130, 130, 130] as [number, number, number], fontStyle: 'italic' as const } }],
        ]
      }),
  })

  const afterItemsY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: afterItemsY,
    head: [['Pago', 'Monto']],
    body: payments.map((p) => [paymentLabels[p.payment_method], formatCLP(p.amount)]),
    foot: [['Total', formatCLP(sale.total)]],
  })

  let afterY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  if (sale.notes) {
    doc.setFontSize(9)
    doc.setTextColor(80)
    doc.text('Notas:', 14, afterY)
    const noteLines = doc.splitTextToSize(sale.notes, 180)
    doc.text(noteLines, 14, afterY + 5)
    afterY += 5 + noteLines.length * 4.5 + 4
    doc.setTextColor(0)
  }

  if (context.credit && context.credit.remaining > 0) {
    doc.setFontSize(9)
    doc.setTextColor(180, 100, 0)
    const dueText = context.credit.dueDate ? ` · vence ${formatDate(context.credit.dueDate)}` : ''
    doc.text(
      `Crédito: pagado ${formatCLP(context.credit.paidAmount)} de ${formatCLP(context.credit.creditAmount)} · resta ${formatCLP(context.credit.remaining)}${dueText}`,
      14,
      afterY
    )
    doc.setTextColor(0)
  }

  if (sale.status === 'cancelled') {
    doc.setTextColor(200, 0, 0)
    doc.setFontSize(11)
    doc.text(`VENTA ANULADA${sale.cancel_reason ? ` — ${sale.cancel_reason}` : ''}`, 14, afterY + 6)
    doc.setTextColor(0)
  }

  doc.save(`venta-${sale.sale_number ?? sale.id}.pdf`)
}
