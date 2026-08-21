export type ContainerFieldTarget = 'code' | 'product_name' | 'calidad' | 'expected_qty' | 'unit' | 'notes' | 'ignore'

// i18n keys, not literal text — this file has no access to the translation
// hook (it's plain data/logic, not a component), so callers resolve these
// via t(fieldTargetI18nKey[target]).
export const fieldTargetI18nKey: Record<ContainerFieldTarget, string> = {
  code: 'fieldTarget.code',
  product_name: 'fieldTarget.product_name',
  calidad: 'fieldTarget.calidad',
  expected_qty: 'fieldTarget.expected_qty',
  unit: 'fieldTarget.unit',
  notes: 'fieldTarget.notes',
  ignore: 'fieldTarget.ignore',
}

export const containerRequiredFields: ContainerFieldTarget[] = ['code', 'product_name', 'expected_qty']

export function guessContainerField(header: string): ContainerFieldTarget {
  const h = header.toLowerCase().trim()
  if (h.includes('codigo') || h.includes('código') || h.includes('code')) return 'code'
  if (h.includes('produc') || h.includes('descrip')) return 'product_name'
  if (h.includes('calidad') || h.includes('quality')) return 'calidad'
  if (h.includes('cantidad') || h.includes('qty') || h.includes('quant') || h.includes('fardo')) return 'expected_qty'
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
