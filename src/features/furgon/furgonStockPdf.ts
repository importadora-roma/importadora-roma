import { createPdfDoc, autoTable, getLogoDataUrl } from '@/lib/pdf'
import { formatCLP, formatKilo, formatDateTime } from '@/lib/format'

export interface FurgonStockRow {
  productName: string
  calidad: string
  kilo: number
  quantity: number
  price: number
}

// Simple snapshot of what's physically on the van right now — same rows as
// the "Fardos a bordo" table on screen, as a downloadable PDF.
export async function generateFurgonStockReportPdf(rows: FurgonStockRow[]) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc('Stock actual del furgón', formatDateTime(new Date().toISOString()), { logoDataUrl })

  const totalQuantity = rows.reduce((s, r) => s + r.quantity, 0)
  const totalValue = rows.reduce((s, r) => s + r.quantity * r.price, 0)

  autoTable(doc, {
    startY: contentY,
    head: [['Producto', 'Cantidad', 'Precio unit.', 'Valor total']],
    body: rows.map((r) => [
      `${r.productName} — ${r.calidad} ${formatKilo(r.kilo)}`,
      String(r.quantity),
      formatCLP(r.price),
      formatCLP(r.quantity * r.price),
    ]),
    foot: [['Total', String(totalQuantity), '', formatCLP(totalValue)]],
  })

  doc.save(`stock-furgon-${new Date().toISOString().slice(0, 10)}.pdf`)
}
