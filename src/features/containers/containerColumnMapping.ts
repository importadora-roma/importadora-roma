export type ContainerFieldTarget =
  | 'code'
  | 'product_name'
  | 'calidad'
  | 'expected_qty'
  | 'unit'
  | 'cost_usd_per_kilo'
  | 'notes'
  | 'ignore'

// i18n keys, not literal text — this file has no access to the translation
// hook (it's plain data/logic, not a component), so callers resolve these
// via t(fieldTargetI18nKey[target]).
export const fieldTargetI18nKey: Record<ContainerFieldTarget, string> = {
  code: 'fieldTarget.code',
  product_name: 'fieldTarget.product_name',
  calidad: 'fieldTarget.calidad',
  expected_qty: 'fieldTarget.expected_qty',
  unit: 'fieldTarget.unit',
  cost_usd_per_kilo: 'fieldTarget.cost_usd_per_kilo',
  notes: 'fieldTarget.notes',
  ignore: 'fieldTarget.ignore',
}

// 'code' is deliberately NOT required — many suppliers' shipping lists
// have no code column at all; the fardo code only exists on the physical
// label and gets learned onto the item the first time it's scanned and
// manually matched during counting (see resolve_unknown_code).
export const containerRequiredFields: ContainerFieldTarget[] = ['product_name', 'expected_qty']

export function guessContainerField(header: string): ContainerFieldTarget {
  const h = header.toLowerCase().trim()
  if (h.includes('codigo') || h.includes('código') || h.includes('code')) return 'code'
  if (h.includes('produc') || h.includes('descrip')) return 'product_name'
  if (h.includes('calidad') || h.includes('quality')) return 'calidad'
  if (h.includes('cantidad') || h.includes('qty') || h.includes('quant') || h.includes('fardo')) return 'expected_qty'
  if (h.includes('usd') || h.includes('costo') || h.includes('cost') || h.includes('precio') || h.includes('price') || h.includes('dolar'))
    return 'cost_usd_per_kilo'
  if (h.includes('unidad') || h.includes('unit')) return 'unit'
  if (h.includes('nota') || h.includes('note') || h.includes('observ')) return 'notes'
  return 'ignore'
}

export function guessHeaderRowIndex(rows: string[][]): number {
  let bestIndex = 0
  let bestCount = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const nonEmpty = rows[i].filter((cell) => cell.trim() !== '').length
    if (nonEmpty > bestCount) {
      bestCount = nonEmpty
      bestIndex = i
    }
  }
  return bestIndex
}
