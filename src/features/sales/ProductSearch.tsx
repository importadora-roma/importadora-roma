import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Camera, Search } from 'lucide-react'
import { formatCLP, formatKilo } from '@/lib/format'
import { CameraScanModal } from './CameraScanModal'
import type { CatalogEntry } from './useSaleCatalog'
import { useTopSellingVariantIds } from './useTopSellingVariants'

const SEARCH_RESULTS_LIMIT = 50
const DEFAULT_RESULTS_LIMIT = 20

export function ProductSearch({
  catalog,
  onSelect,
  branchId,
}: {
  catalog: CatalogEntry[]
  onSelect: (entry: CatalogEntry) => void
  branchId: string
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { topVariantIds } = useTopSellingVariantIds(branchId)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = term.trim().toLowerCase()

    if (!q) {
      // Nothing typed yet — lead with what actually sells in this branch,
      // instead of an arbitrary slice of the catalog, so staff can start
      // checking off fardos right away.
      const catalogById = new Map(catalog.map((c) => [c.variantId, c]))
      const bestSellers = topVariantIds
        .map((id) => catalogById.get(id))
        .filter((c): c is CatalogEntry => !!c && (showOutOfStock || c.stock > 0))
      if (bestSellers.length > 0) return bestSellers.slice(0, DEFAULT_RESULTS_LIMIT)
      // No sales history yet for this branch/period — fall back to the catalog.
      return catalog.filter((c) => showOutOfStock || c.stock > 0).slice(0, DEFAULT_RESULTS_LIMIT)
    }

    const matches = catalog
      .filter((c) => showOutOfStock || c.stock > 0)
      .filter(
        (c) => c.productName.toLowerCase().includes(q) || c.calidad.toLowerCase().includes(q) || c.barcodes.some((b) => b.toLowerCase() === q)
      )
    return matches.sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0)).slice(0, SEARCH_RESULTS_LIMIT)
  }, [catalog, term, showOutOfStock, topVariantIds])

  const isDefaultView = !term.trim()

  function selectAndClear(entry: CatalogEntry) {
    onSelect(entry)
    setTerm('')
    setOpen(false)
    setSelected(new Set())
    inputRef.current?.focus()
  }

  function toggleSelected(variantId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(variantId)) next.delete(variantId)
      else next.add(variantId)
      return next
    })
  }

  function addSelected() {
    // Iterate the full catalog, not just the current results — the
    // selection can span several different searches (e.g. picking 5-6
    // different fardos one search term at a time) before adding them all.
    for (const entry of catalog) {
      if (selected.has(entry.variantId)) onSelect(entry)
    }
    setTerm('')
    setOpen(false)
    setSelected(new Set())
  }

  const normalizeCode = (c: string) => c.replace(/[\s-]/g, '').toLowerCase()

  function findBySku(raw: string): CatalogEntry | undefined {
    const code = normalizeCode(raw)
    if (!code) return undefined
    return catalog.find((c) => c.barcodes.some((b) => normalizeCode(b) === code))
  }

  // A barcode scanner types the whole code in a burst, usually ending with
  // Enter (some are set up with Tab or nothing at all). Enter/Tab add an exact
  // SKU match right away; without a terminator, a short pause after the last
  // character does the same, so the scan never just sits in the search box.
  // The cart takes the item and the box is cleared and refocused for the next scan.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return
    const scanned = findBySku(term)
    if (scanned) {
      e.preventDefault()
      selectAndClear(scanned)
    }
  }

  useEffect(() => {
    if (term.trim().length < 6) return
    const timer = setTimeout(() => {
      const scanned = findBySku(term)
      if (scanned) selectAndClear(scanned)
    }, 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  function handleCameraDetect(code: string) {
    setScannerOpen(false)
    const scanned = findBySku(code)
    if (scanned) {
      selectAndClear(scanned)
    } else {
      setTerm(code)
      setOpen(true)
    }
  }

  return (
    <div className="relative">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar producto por nombre, calidad o escanear código..."
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          title="Escanear con cámara"
          className="rounded-md border border-slate-300 px-3 text-slate-600 hover:bg-slate-50"
        >
          <Camera size={16} />
        </button>
      </div>

      <CameraScanModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetect={handleCameraDetect} />

      {open && (
        <>
          <button aria-label="Cerrar búsqueda" onClick={() => setOpen(false)} className="fixed inset-0 z-0 cursor-default" />
          <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {isDefaultView && (
            <p className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Más vendidos
            </p>
          )}
          <label className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showOutOfStock}
              onChange={(e) => setShowOutOfStock(e.target.checked)}
            />
            Mostrar productos sin stock
          </label>
          {results.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">
              {showOutOfStock ? 'Sin resultados.' : 'Sin resultados con stock. Prueba "mostrar sin stock".'}
            </p>
          )}
          {results.map((r) => (
            <div key={r.variantId} className="flex w-full items-center gap-2 px-2 py-1 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.has(r.variantId)}
                onChange={() => toggleSelected(r.variantId)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
                aria-label={`Seleccionar ${r.productName}`}
              />
              <button
                onClick={() => selectAndClear(r)}
                className="flex flex-1 items-center justify-between py-1 pl-1 text-left text-sm"
              >
                <span>
                  <span className="font-medium text-slate-900">{r.productName}</span>
                  <span className="text-slate-500"> — {r.calidad} {formatKilo(r.kilo)}</span>
                </span>
                <span className={`ml-4 shrink-0 ${r.stock <= 0 ? 'text-red-600' : 'text-slate-600'}`}>
                  {formatCLP(r.price)} · stock {r.stock}
                </span>
              </button>
            </div>
          ))}
          {selected.size > 0 && (
            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
              <span className="text-xs text-slate-500">{selected.size} seleccionado{selected.size === 1 ? '' : 's'}</span>
              <button
                onClick={addSelected}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Agregar {selected.size} producto{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  )
}
