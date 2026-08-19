import { createPdfDoc, autoTable } from '@/lib/pdf'
import { formatCLP, formatDateTime } from '@/lib/format'
import type { Sale, SaleItem, SalePayment } from './useSales'
import type { PaymentMethod } from '@/types/database'

const paymentLabels: Record<PaymentMethod, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

export function generateSalePdf(
  sale: Sale,
  items: SaleItem[],
  payments: SalePayment[],
  context: {
    branchName: string
    customerName: string | null
    variantLabel: (variantId: string) => string
  }
) {
  const doc = createPdfDoc(`Comprobante de venta ${sale.sale_number ?? ''}`, `${context.branchName} · ${formatDateTime(sale.created_at)}`)

  if (context.customerName) {
    doc.setFontSize(9)
    doc.text(`Cliente: ${context.customerName}`, 14, 38)
  }

  autoTable(doc, {
    startY: context.customerName ? 44 : 38,
    head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
    body: items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => [
        `${context.variantLabel(i.variant_id)}${i.status === 'returned' ? ' (cambiado)' : ''}`,
        String(i.quantity),
        formatCLP(i.sold_price),
        formatCLP(i.line_total),
      ]),
  })

  const afterItemsY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: afterItemsY,
    head: [['Pago', 'Monto']],
    body: payments.map((p) => [paymentLabels[p.payment_method], formatCLP(p.amount)]),
    foot: [['Total', formatCLP(sale.total)]],
  })

  if (sale.status === 'cancelled') {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    doc.setTextColor(200, 0, 0)
    doc.setFontSize(11)
    doc.text(`VENTA ANULADA${sale.cancel_reason ? ` — ${sale.cancel_reason}` : ''}`, 14, y)
    doc.setTextColor(0)
  }

  doc.save(`venta-${sale.sale_number ?? sale.id}.pdf`)
}
