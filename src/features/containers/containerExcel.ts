import { exportMultiSheetExcel } from '@/lib/excel'
import { formatDateTime } from '@/lib/format'
import type { Container, ItemWithProgress, ScanEvent, UnknownCode } from './types'

const statusLabels: Record<ItemWithProgress['itemStatus'], string> = {
  empty: 'SIN ESCANEAR',
  partial: 'FALTA',
  complete: 'COMPLETO',
  over: 'EXCESO',
}

export function exportContainerExcel(
  container: Container,
  itemsWithProgress: ItemWithProgress[],
  events: ScanEvent[],
  unknownCodes: UnknownCode[]
) {
  const expected = itemsWithProgress.reduce((s, i) => s + i.expected_qty, 0)
  const scanned = itemsWithProgress.reduce((s, i) => s + i.scannedQty, 0)

  const summaryRows = [
    { Campo: 'Contenedor', Valor: container.internal_number ?? '' },
    { Campo: 'Código', Valor: container.code },
    { Campo: 'Proveedor', Valor: container.supplier ?? '' },
    { Campo: 'Fecha de llegada', Valor: container.arrival_date ?? '' },
    { Campo: 'Estado', Valor: container.status },
    { Campo: 'Total esperado', Valor: expected },
    { Campo: 'Total escaneado', Valor: scanned },
    { Campo: 'Diferencia', Valor: scanned - expected },
    { Campo: 'Productos completos', Valor: itemsWithProgress.filter((i) => i.itemStatus === 'complete').length },
    { Campo: 'Productos totales', Valor: itemsWithProgress.length },
    { Campo: 'Códigos desconocidos', Valor: unknownCodes.length },
  ]

  const itemRows = itemsWithProgress.map((i) => ({
    Producto: i.product_name,
    Calidad: i.calidad ?? '',
    Código: i.code ?? '',
    Esperado: i.expected_qty,
    Escaneado: i.scannedQty,
    Restante: i.remaining,
    Estado: statusLabels[i.itemStatus],
  }))

  const historyRows = events.map((e) => ({
    Fecha: formatDateTime(e.created_at),
    Código: e.code_raw,
    Tipo: e.event_type === 'undo' ? 'DESHACER' : 'ESCANEO',
    Cantidad: e.delta,
    Método: e.method,
    Estado: e.match_status,
    'Confianza OCR': e.confidence ?? '',
    Corregido: e.corrected ? 'Sí' : 'No',
  }))

  const unknownRows = unknownCodes.map((u) => ({
    Código: u.first_raw_code,
    'Veces escaneado': u.scan_count,
    Estado: u.status,
    Notas: u.resolution_notes ?? '',
  }))

  const missingOverRows = itemsWithProgress
    .filter((i) => i.itemStatus !== 'complete')
    .map((i) => ({
      Producto: i.product_name,
      Calidad: i.calidad ?? '',
      Código: i.code ?? '',
      Esperado: i.expected_qty,
      Escaneado: i.scannedQty,
      Diferencia: i.scannedQty - i.expected_qty,
      Tipo: i.itemStatus === 'over' ? 'EXCESO' : 'FALTANTE',
    }))

  exportMultiSheetExcel(`${container.internal_number ?? container.code}.xlsx`, [
    { name: 'Resumen', rows: summaryRows },
    { name: 'Comparación', rows: itemRows },
    { name: 'Historial de escaneos', rows: historyRows },
    { name: 'Códigos desconocidos', rows: unknownRows },
    { name: 'Faltantes y excesos', rows: missingOverRows },
  ])
}
