import { createPdfDoc, autoTable, getLogoDataUrl } from '@/lib/pdf'
import { formatDate } from '@/lib/format'
import type { Container, ItemWithProgress } from './types'

const statusLabels: Record<ItemWithProgress['itemStatus'], string> = {
  empty: 'Sin escanear',
  partial: 'Falta',
  complete: 'Completo',
  over: 'Exceso',
}

export async function generateContainerPdf(
  container: Container,
  itemsWithProgress: ItemWithProgress[],
  unknownCount: number,
  branch?: { name: string; address: string | null }
) {
  const expected = itemsWithProgress.reduce((s, i) => s + i.expected_qty, 0)
  const scanned = itemsWithProgress.reduce((s, i) => s + i.scannedQty, 0)

  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(
    `Recepción de contenedor ${container.internal_number ?? ''}`,
    `${container.code}${container.supplier ? ` · ${container.supplier}` : ''}${container.arrival_date ? ` · ${formatDate(container.arrival_date)}` : ''}`,
    { logoDataUrl, branchName: branch?.name, branchAddress: branch?.address }
  )

  doc.setFontSize(9)
  doc.text(
    [
      `Esperado: ${expected}    Escaneado: ${scanned}    Diferencia: ${scanned - expected}`,
      `Productos completos: ${itemsWithProgress.filter((i) => i.itemStatus === 'complete').length} / ${itemsWithProgress.length}    Códigos desconocidos: ${unknownCount}`,
    ],
    14,
    contentY
  )

  autoTable(doc, {
    startY: contentY + 10,
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
