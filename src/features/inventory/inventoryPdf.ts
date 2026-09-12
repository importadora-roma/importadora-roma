import { createPdfDoc, autoTable, getLogoDataUrl, BRAND_NAVY } from '@/lib/pdf'
import { formatCLP, formatKilo, formatDateTime } from '@/lib/format'

export interface InventoryPdfRow {
  productName: string
  calidad: string
  kilo: number
  sku: string | null
  cost: number
  price: number
  stock: number
}

export async function generateInventoryPdf(
  rows: InventoryPdfRow[],
  context: { branchName: string; branchAddress: string | null; canSeeCost: boolean }
) {
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc('Inventario', formatDateTime(new Date().toISOString()), {
    logoDataUrl,
    branchName: context.branchName,
    branchAddress: context.branchAddress,
  })

  const totalStock = rows.reduce((s, r) => s + r.stock, 0)
  const totalCostValue = rows.reduce((s, r) => s + r.cost * r.stock, 0)
  const totalPriceValue = rows.reduce((s, r) => s + r.price * r.stock, 0)

  const head = context.canSeeCost
    ? ['Producto', 'Calidad', 'Kilo', 'Código', 'Costo', 'Precio', 'Stock']
    : ['Producto', 'Calidad', 'Kilo', 'Código', 'Precio', 'Stock']

  const body = rows.map((r) =>
    context.canSeeCost
      ? [r.productName, r.calidad, formatKilo(r.kilo), r.sku ?? '—', formatCLP(r.cost), formatCLP(r.price), String(r.stock)]
      : [r.productName, r.calidad, formatKilo(r.kilo), r.sku ?? '—', formatCLP(r.price), String(r.stock)]
  )

  const foot = context.canSeeCost
    ? [['', '', '', '', formatCLP(totalCostValue), formatCLP(totalPriceValue), String(totalStock)]]
    : [['', '', '', '', formatCLP(totalPriceValue), String(totalStock)]]

  autoTable(doc, {
    startY: contentY,
    head: [head],
    body,
    foot,
    headStyles: { fillColor: BRAND_NAVY },
    footStyles: { fillColor: [241, 245, 249], textColor: BRAND_NAVY, fontStyle: 'bold' },
    columnStyles: context.canSeeCost
      ? { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
      : { 4: { halign: 'right' }, 5: { halign: 'right' } },
  })

  doc.save(`inventario-${context.branchName || 'sucursal'}.pdf`)
}
