import { createPdfDoc, autoTable, getLogoDataUrl } from '@/lib/pdf'
import { formatCLP, formatDate, formatDateTime } from '@/lib/format'
import type { Transfer, TransferItem } from '@/features/transfers/useTransfers'

export interface FurgonLoadEntry {
  transfer: Transfer
  items: TransferItem[]
  originName: string
}

// One PDF covering every "Cargar stock" guía within a date range: a
// consolidated by-product summary first (what actually went out to the van
// in the period), then each individual guía broken out below for
// traceability back to a specific load and origin branch.
export async function generateFurgonLoadsReportPdf(
  loads: FurgonLoadEntry[],
  context: { from: string; to: string; variantLabel: (variantId: string) => string }
) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(
    'Reporte de cargas al furgón',
    `${formatDate(`${context.from}T00:00:00`)} – ${formatDate(`${context.to}T00:00:00`)}`,
    { logoDataUrl }
  )

  let y = contentY

  if (loads.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text('No hubo cargas al furgón en este período.', 14, y)
    doc.save(`cargas-furgon-${context.from}-a-${context.to}.pdf`)
    return
  }

  // Consolidated summary: same product loaded across several guías on
  // different days collapses into one row, quantity and value summed.
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

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(30)
  doc.text('Resumen por producto', 14, y)
  doc.setFont('helvetica', 'normal')
  y += 4

  autoTable(doc, {
    startY: y,
    head: [['Producto', 'Cantidad', 'Valor total']],
    body: summaryRows.map((r) => [r.label, String(r.quantity), formatCLP(r.value)]),
    foot: [['Total', String(grandQuantity), formatCLP(grandTotal)]],
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(30)
  doc.text('Detalle por guía', 14, y)
  doc.setFont('helvetica', 'normal')
  y += 6

  for (const load of loads) {
    if (y > 260) {
      doc.addPage()
      y = 20
    }
    const subtotal = load.items.reduce((s, i) => s + (i.unit_price ?? 0) * i.quantity, 0)

    doc.setFontSize(9)
    doc.setTextColor(60)
    doc.text(
      `Guía ${load.transfer.transfer_number ?? '—'} · ${formatDateTime(load.transfer.sent_at)} · desde ${load.originName}`,
      14,
      y
    )
    y += 3

    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Cantidad', 'Precio unit.', 'Subtotal']],
      body: load.items.map((i) => [
        context.variantLabel(i.variant_id),
        String(i.quantity),
        i.unit_price ? formatCLP(i.unit_price) : '—',
        i.unit_price ? formatCLP(i.unit_price * i.quantity) : '—',
      ]),
      foot: [['', '', 'Subtotal', formatCLP(subtotal)]],
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }

  doc.save(`cargas-furgon-${context.from}-a-${context.to}.pdf`)
}
