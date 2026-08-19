import { useMemo, useRef, useState } from 'react'
import { Upload, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Input'
import { parseCLNumber } from '@/lib/format'
import { parseDelimitedText, parseSpreadsheetFile } from '@/lib/excel'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from './useInventory'
import type { Product, ProductVariant } from '@/types/models'

type FieldTarget =
  | 'producto'
  | 'categoria'
  | 'calidad'
  | 'kilo'
  | 'sku'
  | 'proveedor'
  | 'costo'
  | 'precio'
  | 'stock'
  | 'stock_fijo'
  | 'ignore'

const fieldLabels: Record<FieldTarget, string> = {
  producto: 'Producto',
  categoria: 'Categoría (opcional)',
  calidad: 'Calidad',
  kilo: 'Kilo',
  sku: 'SKU (opcional)',
  proveedor: 'Proveedor (opcional)',
  costo: 'Costo (opcional)',
  precio: 'Precio (opcional)',
  stock: 'Stock',
  stock_fijo: 'Stock adicional a un kilo fijo',
  ignore: 'Ignorar columna',
}

const requiredFields: FieldTarget[] = ['producto', 'calidad', 'stock']

interface ParsedRow {
  rowIndex: number
  producto: string
  categoria: string
  calidad: string
  sku: string
  proveedor: string
  kilo: number | null
  costo: number | null
  precio: number | null
  stock: number | null
  errors: string[]
}

type Step = 'input' | 'header-select' | 'mapping' | 'preview' | 'importing' | 'done'

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

export function ImportPage() {
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const { products, variants, reload: reloadProducts } = useProducts()
  const { inventory, reload: reloadInventory } = useInventory()

  const [step, setStep] = useState<Step>('input')
  const [allRows, setAllRows] = useState<string[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<FieldTarget[]>([])
  const [fixedKilos, setFixedKilos] = useState<string[]>([])
  const [kiloDefaults, setKiloDefaults] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'set' | 'add'>('set')
  const [importNote, setImportNote] = useState('')
  const [branchId, setBranchId] = useState(activeBranchId)
  const [pasteText, setPasteText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<{ productsCreated: number; variantsCreated: number; variantsUpdated: number; stockUpdated: number; failed: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setFixedKilos(headerRow.map((h) => guessFixedKilo(h)))
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
    const rows = parseDelimitedText(pasteText)
    loadRows(rows)
  }

  const extraKiloColumns = useMemo(
    () =>
      mapping
        .map((target, colIndex) => ({ colIndex, target }))
        .filter((c) => c.target === 'stock_fijo')
        .map((c) => ({ colIndex: c.colIndex, kilo: parseCLNumber(fixedKilos[c.colIndex] ?? '') })),
    [mapping, fixedKilos]
  )

  const kiloColumnMapped = mapping.includes('kilo')

  // When the file has no Kilo column, we still need one per row: try to read
  // it off the product name (e.g. "SUETER MIXTO 45KG"), and otherwise fall
  // back to a per-calidad default the admin sets below.
  const distinctCalidades = useMemo(() => {
    if (kiloColumnMapped) return []
    const calidadCol = mapping.indexOf('calidad')
    if (calidadCol === -1) return []
    const set = new Set<string>()
    for (const row of rawRows) {
      const v = (row[calidadCol] ?? '').trim()
      if (v) set.add(v)
    }
    return Array.from(set).sort()
  }, [kiloColumnMapped, mapping, rawRows])

  function resolveKilo(producto: string, calidad: string, mappedKilo: number | null): number | null {
    if (kiloColumnMapped) return mappedKilo
    const match = producto.match(/(\d+)\s*KG/i)
    if (match) return Number(match[1])
    return parseCLNumber(kiloDefaults[calidad] ?? '')
  }

  const parsedRows: ParsedRow[] = useMemo(() => {
    if (step !== 'preview' && step !== 'importing' && step !== 'done') return []
    const result: ParsedRow[] = []

    rawRows.forEach((row, rowIndex) => {
      const get = (field: FieldTarget) => {
        const colIndex = mapping.indexOf(field)
        return colIndex === -1 ? '' : (row[colIndex] ?? '').trim()
      }
      const producto = get('producto')
      const categoria = get('categoria')
      const calidad = get('calidad')
      const sku = get('sku')
      const proveedor = get('proveedor')
      const kilo = resolveKilo(producto, calidad, parseCLNumber(get('kilo')))
      const costo = parseCLNumber(get('costo'))
      const precio = parseCLNumber(get('precio'))
      const stockRaw = get('stock')
      const stock = stockRaw === '' ? 0 : parseCLNumber(stockRaw)

      const errors: string[] = []
      if (!producto) errors.push('Producto vacío')
      if (!calidad) errors.push('Calidad vacía')
      if (kilo === null || kilo <= 0) errors.push('Kilo inválido')
      if (costo !== null && costo < 0) errors.push('Costo inválido')
      if (precio !== null && precio < 0) errors.push('Precio inválido')
      if (stock === null || stock < 0) errors.push('Stock inválido')

      result.push({ rowIndex, producto, categoria, calidad, sku, proveedor, kilo, costo, precio, stock, errors })

      // Extra fixed-kilo stock columns: same producto/calidad, different kilo,
      // only emitted when this row actually has a value in that column.
      for (const extra of extraKiloColumns) {
        const cellRaw = (row[extra.colIndex] ?? '').trim()
        if (!cellRaw) continue
        const extraStock = parseCLNumber(cellRaw)
        const extraErrors: string[] = []
        if (!producto) extraErrors.push('Producto vacío')
        if (!calidad) extraErrors.push('Calidad vacía')
        if (extra.kilo === null || extra.kilo <= 0) extraErrors.push('Kilo fijo de la columna inválido')
        if (extraStock === null || extraStock < 0) extraErrors.push('Stock inválido')

        result.push({
          rowIndex,
          producto,
          categoria,
          calidad,
          sku,
          proveedor,
          kilo: extra.kilo,
          costo,
          precio,
          stock: extraStock,
          errors: extraErrors,
        })
      }
    })

    return result
  }, [rawRows, mapping, step, extraKiloColumns, kiloDefaults, kiloColumnMapped])

  const validRows = parsedRows.filter((r) => r.errors.length === 0)
  const invalidRows = parsedRows.filter((r) => r.errors.length > 0)

  const mappingComplete =
    requiredFields.every((f) => mapping.includes(f)) &&
    !!branchId &&
    extraKiloColumns.every((c) => c.kilo !== null && c.kilo > 0) &&
    (kiloColumnMapped || distinctCalidades.every((c) => parseCLNumber(kiloDefaults[c] ?? '') !== null))

  async function handleImport() {
    setStep('importing')
    setProgress({ done: 0, total: validRows.length })

    // dedupe by producto+calidad+kilo, summing stock and keeping the last cost/price seen
    const merged = new Map<string, ParsedRow & { stock: number }>()
    for (const row of validRows) {
      const key = `${row.producto.toLowerCase()}|${row.calidad.toLowerCase()}|${row.kilo}`
      const existing = merged.get(key)
      if (existing) {
        existing.stock = (existing.stock ?? 0) + (row.stock ?? 0)
        existing.costo = row.costo
        existing.precio = row.precio
        existing.proveedor = row.proveedor || existing.proveedor
      } else {
        merged.set(key, { ...row, stock: row.stock ?? 0 })
      }
    }
    const rowsToImport = Array.from(merged.values())

    const productByName = new Map(products.map((p) => [p.name.toLowerCase(), p]))
    const variantByKey = new Map(variants.map((v) => [`${v.product_id}|${v.calidad.toLowerCase()}|${v.kilo}`, v]))
    // Snapshot of current stock at the target branch, used in "add" mode to
    // compute existing + incoming instead of overwriting.
    const currentStockByVariant = new Map(
      inventory.filter((i) => i.branch_id === branchId).map((i) => [i.variant_id, i.quantity])
    )
    // Concurrent workers can race to create the same brand-new product name;
    // this makes every worker await the same in-flight insert instead of
    // each independently seeing "not found" and inserting a duplicate.
    const pendingProductCreates = new Map<string, Promise<Product>>()

    async function getOrCreateProduct(name: string, category: string | null): Promise<Product> {
      const key = name.toLowerCase()
      const existing = productByName.get(key)
      if (existing) return existing

      const pending = pendingProductCreates.get(key)
      if (pending) return pending

      const creation = (async () => {
        const { data, error } = await supabase.from('products').insert({ name, category: category || null }).select().single()
        if (error) throw error
        const product = data as unknown as Product
        productByName.set(key, product)
        productsCreated += 1
        return product
      })()
      pendingProductCreates.set(key, creation)
      return creation
    }

    const pendingVariantCreates = new Map<string, Promise<ProductVariant>>()

    async function getOrCreateVariant(
      productId: string,
      calidad: string,
      kilo: number,
      sku: string | null,
      cost: number,
      price: number,
      supplier: string | null
    ): Promise<{ variant: ProductVariant; created: boolean }> {
      const key = `${productId}|${calidad.toLowerCase()}|${kilo}`
      const existing = variantByKey.get(key)
      if (existing) return { variant: existing, created: false }

      const pending = pendingVariantCreates.get(key)
      if (pending) return { variant: await pending, created: false }

      const creation = (async () => {
        const { data, error } = await supabase
          .from('product_variants')
          .insert({ product_id: productId, calidad, kilo, sku, cost, price, supplier })
          .select()
          .single()
        if (error) throw error
        const variant = data as unknown as ProductVariant
        variantByKey.set(key, variant)
        return variant
      })()
      pendingVariantCreates.set(key, creation)
      return { variant: await creation, created: true }
    }

    let productsCreated = 0
    let variantsCreated = 0
    let variantsUpdated = 0
    let stockUpdated = 0
    let failed = 0

    const concurrency = 8
    let cursor = 0

    async function worker() {
      while (cursor < rowsToImport.length) {
        const row = rowsToImport[cursor]
        cursor += 1
        try {
          const product = await getOrCreateProduct(row.producto, row.categoria)

          const { variant, created } = await getOrCreateVariant(
            product.id,
            row.calidad,
            row.kilo!,
            row.sku || null,
            row.costo ?? 0,
            row.precio ?? 0,
            row.proveedor || null
          )
          if (created) {
            variantsCreated += 1
          } else {
            // Only touch cost/price/proveedor when the file actually provided
            // a value for this row — a blank cell must never silently clear
            // an existing value, since these are often filled in later.
            const update: { cost?: number; price?: number; supplier?: string } = {}
            if (row.costo !== null && row.costo !== variant.cost) update.cost = row.costo
            if (row.precio !== null && row.precio !== variant.price) update.price = row.precio
            if (row.proveedor && row.proveedor !== variant.supplier) update.supplier = row.proveedor
            if (Object.keys(update).length > 0) {
              const { error } = await supabase.from('product_variants').update(update).eq('id', variant.id)
              if (error) throw error
              Object.assign(variant, update)
              variantsUpdated += 1
            }
          }

          const targetQuantity =
            mode === 'add' ? (currentStockByVariant.get(variant!.id) ?? 0) + row.stock! : row.stock!

          const { error: invError } = await supabase.rpc('adjust_inventory', {
            p_variant_id: variant!.id,
            p_branch_id: branchId,
            p_new_quantity: targetQuantity,
            p_reason:
              mode === 'add'
                ? `Ingreso de contenedor (Excel)${importNote ? ` — ${importNote}` : ''}`
                : 'Importación desde Excel',
          })
          if (invError) throw invError
          currentStockByVariant.set(variant!.id, targetQuantity)
          stockUpdated += 1
        } catch {
          failed += 1
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }))
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    await reloadProducts()
    await reloadInventory()
    setSummary({ productsCreated, variantsCreated, variantsUpdated, stockUpdated, failed })
    setStep('done')
  }

  function reset() {
    setStep('input')
    setAllRows([])
    setHeaderRowIndex(0)
    setRawRows([])
    setHeaders([])
    setMapping([])
    setFixedKilos([])
    setKiloDefaults({})
    setMode('set')
    setImportNote('')
    setPasteText('')
    setLoadError(null)
    setSummary(null)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Importar desde Excel</h1>
      <p className="mt-1 text-sm text-slate-500">
        Carga tu archivo de inventario (.xlsx, .xls o .csv) o pega los datos copiados desde Excel.
      </p>

      {step === 'input' && (
        <div className="mt-6 space-y-6">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center"
          >
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
            <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Producto	Calidad	Kilo	Costo	Precio	Stock..." />
            <Button className="mt-2" onClick={handlePasteImport} disabled={!pasteText.trim()}>
              Continuar
            </Button>
          </div>

          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        </div>
      )}

      {step === 'header-select' && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-700">
            Selecciona qué fila contiene los nombres de columna (Producto, Calidad, Kilo, etc.). Las filas anteriores
            se ignoran.
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {allRows.slice(0, 15).map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setHeaderRowIndex(i)}
                    className={`cursor-pointer ${i === headerRowIndex ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
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
              Cancelar
            </Button>
            <Button onClick={confirmHeaderRow}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="mt-6 space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Sucursal destino</p>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
              <option value="">Selecciona sucursal...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Modo de importación</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={mode === 'set'} onChange={() => setMode('set')} />
                Reemplazar stock (carga inicial / recuento físico)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} />
                Sumar al stock existente (llegada de contenedor)
              </label>
            </div>
            {mode === 'add' && (
              <input
                type="text"
                placeholder="Referencia (opcional, ej: Contenedor BMOU 676322-8)"
                value={importNote}
                onChange={(e) => setImportNote(e.target.value)}
                className="mt-2 w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Asigna cada columna detectada ({rawRows.length} filas de datos):
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Columna en el archivo</th>
                    <th className="px-4 py-2">Ejemplo</th>
                    <th className="px-4 py-2">Mapear a</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {headers.map((header, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 font-medium text-slate-900">{header || `Columna ${i + 1}`}</td>
                      <td className="px-4 py-2 text-slate-500">{rawRows[0]?.[i] ?? ''}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
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
                          {mapping[i] === 'stock_fijo' && (
                            <input
                              type="number"
                              placeholder="Kilo"
                              value={fixedKilos[i] ?? ''}
                              onChange={(e) => {
                                const next = [...fixedKilos]
                                next[i] = e.target.value
                                setFixedKilos(next)
                              }}
                              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingComplete && (
              <p className="mt-2 text-sm text-amber-600">
                Falta asignar: {requiredFields.filter((f) => !mapping.includes(f)).map((f) => fieldLabels[f]).join(', ')}
                {!branchId && ', Sucursal'}
                {extraKiloColumns.some((c) => c.kilo === null || c.kilo <= 0) && ', Kilo de columna(s) de stock adicional'}
              </p>
            )}
          </div>

          {!kiloColumnMapped && distinctCalidades.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">
                No hay columna de Kilo. Se usa el kilo escrito en el nombre del producto si existe (ej: "45KG"); si
                no, este valor por defecto según la calidad:
              </p>
              <div className="flex flex-wrap gap-3">
                {distinctCalidades.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <span className="text-sm text-slate-600">{c}</span>
                    <input
                      type="number"
                      placeholder="Kilo"
                      value={kiloDefaults[c] ?? ''}
                      onChange={(e) => setKiloDefaults({ ...kiloDefaults, [c]: e.target.value })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              Cancelar
            </Button>
            <Button onClick={() => setStep('preview')} disabled={!mappingComplete}>
              Previsualizar
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="mt-6 space-y-4">
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 size={16} /> {validRows.length} filas válidas
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle size={16} /> {invalidRows.length} filas con errores
            </span>
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Calidad</th>
                  <th className="px-3 py-2">Kilo</th>
                  <th className="px-3 py-2">Costo</th>
                  <th className="px-3 py-2">Precio</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedRows.map((row) => (
                  <tr key={row.rowIndex} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                    <td className="px-3 py-1.5 text-slate-400">{row.rowIndex + 1}</td>
                    <td className="px-3 py-1.5">{row.producto}</td>
                    <td className="px-3 py-1.5">{row.calidad}</td>
                    <td className="px-3 py-1.5">{row.kilo ?? '—'}</td>
                    <td className="px-3 py-1.5">{row.costo ?? '—'}</td>
                    <td className="px-3 py-1.5">{row.precio ?? '—'}</td>
                    <td className="px-3 py-1.5">{row.stock ?? '—'}</td>
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
            <Button onClick={handleImport} disabled={validRows.length === 0}>
              Importar {validRows.length} filas
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="mt-10 text-center">
          <p className="text-sm text-slate-600">
            Importando {progress.done} de {progress.total}...
          </p>
          <div className="mx-auto mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-slate-900 transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <p className="flex items-center gap-2 text-base font-semibold text-green-700">
            <CheckCircle2 size={20} /> Importación completada
          </p>
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            <li>Productos nuevos: {summary.productsCreated}</li>
            <li>Variantes nuevas: {summary.variantsCreated}</li>
            <li>Variantes actualizadas (costo/precio): {summary.variantsUpdated}</li>
            <li>Filas con stock actualizado: {summary.stockUpdated}</li>
            {summary.failed > 0 && <li className="text-red-600">Filas que fallaron: {summary.failed}</li>}
          </ul>
          <Button className="mt-4" onClick={reset}>
            Importar otro archivo
          </Button>
        </div>
      )}
    </div>
  )
}

function guessField(header: string): FieldTarget {
  const h = header.toLowerCase().trim()
  if (/^\d+\s*kg$/.test(h)) return 'stock_fijo'
  if (h.includes('produc')) return 'producto'
  if (h.includes('categor')) return 'categoria'
  if (h.includes('calidad') || h.includes('quality')) return 'calidad'
  if (h.includes('kilo') || h === 'kg') return 'kilo'
  if (h.includes('sku') || h.includes('codigo') || h.includes('código')) return 'sku'
  if (h.includes('proveedor') || h.includes('supplier')) return 'proveedor'
  if (h.includes('costo') || h.includes('cost')) return 'costo'
  if (h.includes('precio') || h.includes('price')) return 'precio'
  if (h.includes('stock') || h.includes('cantidad') || h.includes('quant')) return 'stock'
  return 'ignore'
}

function guessFixedKilo(header: string): string {
  const match = header.toLowerCase().trim().match(/^(\d+)\s*kg$/)
  return match ? match[1] : ''
}
