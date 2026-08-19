import { createPdfDoc, autoTable } from '@/lib/pdf'
import { formatDateTime } from '@/lib/format'
import type { Transfer, TransferItem } from './useTransfers'

export function generateTransferPdf(
  transfer: Transfer,
  items: TransferItem[],
  context: { originName: string; destinationName: string; variantLabel: (variantId: string) => string }
) {
  const doc = createPdfDoc(
    `Guía de traslado ${transfer.transfer_number ?? ''}`,
    `${context.originName} → ${context.destinationName} · ${formatDateTime(transfer.sent_at)}`
  )

  autoTable(doc, {
    startY: 38,
    head: [['Producto', 'Cantidad']],
    body: items.map((i) => [context.variantLabel(i.variant_id), String(i.quantity)]),
  })

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  if (transfer.notes) {
    doc.setFontSize(9)
    doc.text(`Notas: ${transfer.notes}`, 14, y)
  }

  const signatureY = y + 30
  doc.setFontSize(9)
  doc.line(14, signatureY, 84, signatureY)
  doc.text('Firma envía', 14, signatureY + 5)
  doc.line(120, signatureY, 190, signatureY)
  doc.text('Firma recibe', 120, signatureY + 5)

  doc.save(`traslado-${transfer.transfer_number ?? transfer.id}.pdf`)
}
