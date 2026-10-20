import { useMemo, useRef, useState } from 'react'
import { Upload, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Input'
import { normalizeCalidad, parseCLNumber, formatKilo } from '@/lib/format'
import { parseDelimitedText, parseSpreadsheetFile } from '@/lib/excel'
import { findCatalogEntryByCode, type CatalogEntry } from '@/features/sales/useSaleCatalog'

type FieldTarget = 'producto' | 'calidad' | 'kilo' | 'sku' | 'cantidad' | 'precio' | 'ignore'

const fieldLabels: Record<FieldTarget, string> = {
  producto: 'Producto',
  calidad: 'Calidad',
  kilo: 'Kilo (opcional)',
  sku: 'SKU / código (opcional)',
  cantidad: 'Cantidad',
  precio: 'Precio unitario (opcional)',
  ignore: 'Ignorar columna',
}

interface ParsedRow {
  rowIndex: number
  producto: string
  calidad: string
  sku: string
  cantidad: number | null
  precio: number | null
  match: CatalogEntry | null
  ambiguous: boolean
  errors: string[]
}

type Step = 'input' | 'header-select' | 'mapping' | 'preview'

function guessHeaderRowIndex(rows: string[][]): number {
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

function guessField(header: string): FieldTarget {
  const h = header.toLowerCase().trim()
  if (h.includes('produc')) return 'producto'
  if (h.includes('calidad') || h.includes('quality')) return 'calidad'
  if (h.includes('kilo') || h === 'kg') return 'kilo'
  if (h.includes('sku') || h.includes('codigo') || h.includes('código') || h.includes('barcode')) return 'sku'
  if (h.includes('cantidad') || h.includes('stock') || h.includes('qty') || h.includes('quant')) return 'cantidad'
  // "costo"/"cost" intentionally NOT auto-mapped here: guías record sale
  // price, and a sheet column literally named "Costo" almost always holds
  // actual cost data — auto-guessing it as the price source silently
  // recorded cost on the guía. Still selectable by hand in the mapping step.
  if (h.includes('precio') || h.includes('price')) return 'precio'
  return 'ignore'
}

// Matches a row against the origin branch's own catalog — this never
// creates a product/variant (unlike Inventario > Importar), it only finds
// which *existing* fardo a spreadsheet row refers to. SKU/barcode wins when
// present and matches; otherwise producto+calidad (+kilo when given, or
// when there's only one kilo for that producto+calidad anyway).
function matchCatalogEntry(
  catalog: CatalogEntry[],
  producto: string,
  calidad: string,
  kilo: number | null,
  sku: string
): { entry: CatalogEntry | null; ambiguous: boolean } {
  if (sku) {
    const bySku = findCatalogEntryByCode(catalog, sku)
    if (bySku) return { entry: bySku, ambiguous: false }
  }
  const prodLower = producto.trim().toLowerCase()
  const calLower = normalizeCalidad(calidad).trim().toLowerCase()
  if (!prodLower || !calLower) return { entry: null, ambiguous: false }
  const candidates = catalog.filter((c) => c.productName.trim().toLowerCase() === prodLower && c.calidad.toLowerCase() === calLower)
  if (candidates.length === 0) return { entry: null, ambiguous: false }
  if (kilo !== null) {
    const exact = candidates.find((c) => c.kilo === kilo)
    return { entry: exact ?? null, ambiguous: false }
  }
  if (candidates.length === 1) return { entry: candidates[0], ambiguous: false }
  return { entry: null, ambiguous: true }
}

export function BulkAddItemsModal({
  open,
  onClose,
  catalog,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  catalog: CatalogEntry[]
  onAdd: (lines: { entry: CatalogEntry; quantity: number; unitPrice: string }[]) => void
}) {
  const [step, setStep] = useState<Step>('input')
  const [allRows, setAllRows] = useState<string[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<FieldTarget[]>([])
  const [pasteText, setPasteText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('input')
    setAllRows([])
    setHeaderRowIndex(0)
    setRawRows([])
    setHeaders([])
    setMapping([])
    setPasteText('')
    setLoadError(null)
  }

  function close() {
    reset()
    onClose()
  }

  function loadRows(rows: string[][]) {
    if (rows.length < 2) {
      setLoadError('El archivo debe tener al menos una fila de encabezado y una fila de datos')
      return
    }
    setLoadError(null)
    setAllRows(rows)
    setHeaderRowIndex(guessHeaderRowIndex(rows))
    setStep('header-select')
  }

  function confirmHeaderRow() {
    const headerRow = allRows[headerRowIndex]
    const dataRows = allRows.slice(headerRowIndex + 1)
    setHeaders(headerRow)
    setRawRows(dataRows)
    setMapping(headerRow.map((h) => guessField(h)))
    setStep('mapping')
  }

  async function handleFile(file: File) {
    try {
      const rows = await parseSpreadsheetFile(file)
      loadRows(rows)
    } catch {
      setLoadError('No se pudo leer el archivo. Verifica que sea un .xlsx, .xls o .csv válido')
    }
  }

  function handlePasteImport() {
    loadRows(parseDelimitedText(pasteText))
  }

  const mappingComplete =
    mapping.includes('cantidad') && (mapping.includes('sku') || (mapping.includes('producto') && mapping.includes('calidad')))

  const parsedRows: ParsedRow[] = useMemo(() => {
    if (step !== 'preview') return []
    const get = (row: string[], field: FieldTarget) => {
      const colIndex = mapping.indexOf(field)
      return colIndex === -1 ? '' : (row[colIndex] ?? '').trim()
    }
    return rawRows.map((row, rowIndex) => {
      const producto = get(row, 'producto')
      const calidad = get(row, 'calidad')
      const sku = get(row, 'sku')
      const kilo = parseCLNumber(get(row, 'kilo'))
      const cantidad = parseCLNumber(get(row, 'cantidad'))
      const precio = parseCLNumber(get(row, 'precio'))

      const { entry: match, ambiguous } = matchCatalogEntry(catalog, producto, calidad, kilo, sku)

      const errors: string[] = []
      if (cantidad === null || cantidad <= 0) errors.push('Cantidad inválida')
      if (!match && !ambiguous) errors.push('Producto no encontrado en el catálogo')
      if (ambiguous) errors.push('Hay varios kilos para este producto/calidad — agrega la columna Kilo')
      if (match && cantidad !== null && cantidad > match.stock) errors.push(`Stock disponible: ${match.stock}`)

      return { rowIndex, producto, calidad, sku, cantidad, precio, match, ambiguous, errors }
    })
  }, [step, rawRows, mapping, catalog])

  const validRows = parsedRows.filter((r) => r.errors.length === 0 && r.match)
  const invalidRows = parsedRows.filter((r) => r.errors.length > 0)

  function handleAdd() {
    onAdd(
      validRows.map((r) => ({
        entry: r.match!,
        quantity: r.cantidad!,
        unitPrice: r.precio !== null ? String(r.precio) : String(r.match!.price),
      }))
    )
    close()
  }

  return (
    <Modal open={open} onClose={close} title="Agregar productos desde Excel">
      <div className="space-y-4">
        {step === 'input' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <Upload className="text-slate-400" size={28} />
              <p className="text-sm text-slate-600">Arrastra un archivo aquí o</p>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                Seleccionar archivo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                }}
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">O pega los datos copiados desde Excel (con encabezados):</p>
              <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Producto	Calidad	Kilo	Cantidad..." />
              <Button className="mt-2" onClick={handlePasteImport} disabled={!pasteText.trim()}>
                Continuar
              </Button>
            </div>
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          </div>
        )}

        {step === 'header-select' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">Selecciona qué fila contiene los nombres de columna.</p>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  {allRows.slice(0, 15).map((row, i) => (
                    <tr
                      key={i}
                      onClick={() => setHeaderRowIndex(i)}
                      className={`cursor-pointer ${i === headerRowIndex ? 'bg-brand-800 text-white' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-1.5 text-xs">
                        <input type="radio" checked={i === headerRowIndex} onChange={() => setHeaderRowIndex(i)} className="mr-2" />
                        {i + 1}
                      </td>
                      <td className="px-3 py-1.5">{row.filter(Boolean).join(' | ') || <span className="italic opacity-50">(vacía)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>
                Volver
              </Button>
              <Button onClick={confirmHeaderRow}>Continuar</Button>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-700">Asigna cada columna detectada ({rawRows.length} filas de datos):</p>
            <div className="max-h-80 overflow-x-auto overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Columna</th>
                    <th className="px-3 py-2">Ejemplo</th>
                    <th className="px-3 py-2">Mapear a</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {headers.map((header, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-medium text-slate-900">{header || `Columna ${i + 1}`}</td>
                      <td className="px-3 py-1.5 text-slate-500">{rawRows[0]?.[i] ?? ''}</td>
                      <td className="px-3 py-1.5">
                        <select
                          value={mapping[i]}
                          onChange={(e) => {
                            const next = [...mapping]
                            next[i] = e.target.value as FieldTarget
                            setMapping(next)
                          }}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                        >
                          {Object.entries(fieldLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingComplete && (
              <p className="text-sm text-amber-600">
                Falta asignar Cantidad, y además SKU o bien Producto + Calidad (para identificar el fardo).
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep('header-select')}>
                Volver
              </Button>
              <Button onClick={() => setStep('preview')} disabled={!mappingComplete}>
                Previsualizar
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={16} /> {validRows.length} filas listas
              </span>
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle size={16} /> {invalidRows.length} filas con problemas
              </span>
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Encontrado como</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedRows.map((row) => (
                    <tr key={row.rowIndex} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 text-slate-400">{row.rowIndex + 1}</td>
                      <td className="px-3 py-1.5">
                        {row.producto} — {row.calidad}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {row.match ? `${row.match.productName} — ${row.match.calidad} ${formatKilo(row.match.kilo)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right">{row.cantidad ?? '—'}</td>
                      <td className="px-3 py-1.5 text-red-600">{row.errors.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep('mapping')}>
                Volver
              </Button>
              <Button onClick={handleAdd} disabled={validRows.length === 0}>
                Agregar {validRows.length} productos al traslado
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
