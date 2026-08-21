import { createPdfDoc, autoTable } from '@/lib/pdf'
import { formatDate } from '@/lib/format'
import type { Container, ItemWithProgress } from './types'

const statusLabels: Record<ItemWithProgress['itemStatus'], string> = {
  empty: 'Sin escanear',
  partial: 'Falta',
  complete: 'Completo',
  over: 'Exceso',
}

export function generateContainerPdf(container: Container, itemsWithProgress: ItemWithProgress[], unknownCount: number) {
  const expected = itemsWithProgress.reduce((s, i) => s + i.expected_qty, 0)
  const scanned = itemsWithProgress.reduce((s, i) => s + i.scannedQty, 0)

  const doc = createPdfDoc(
    `Recepción de contenedor ${container.internal_number ?? ''}`,
    `${container.code}${container.supplier ? ` · ${container.supplier}` : ''}${container.arrival_date ? ` · ${formatDate(container.arrival_date)}` : ''}`
  )

  doc.setFontSize(9)
  doc.text(
    [
      `Esperado: ${expected}    Escaneado: ${scanned}    Diferencia: ${scanned - expected}`,
      `Productos completos: ${itemsWithProgress.filter((i) => i.itemStatus === 'complete').length} / ${itemsWithProgress.length}    Códigos desconocidos: ${unknownCount}`,
    ],
    14,
    40
  )

  autoTable(doc, {
    startY: 50,
    head: [['Producto', 'Calidad', 'Código', 'Esperado', 'Escaneado', 'Restante', 'Estado']],
    body: itemsWithProgress.map((i) => [
      i.product_name,
      i.calidad ?? '—',
      i.code ?? '—',
      String(i.expected_qty),
      String(i.scannedQty),
      String(i.remaining),
      statusLabels[i.itemStatus],
    ]),
  })

  doc.save(`${container.internal_number ?? container.code}.pdf`)
}
