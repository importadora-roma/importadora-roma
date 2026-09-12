import { useMemo, useState, type KeyboardEvent } from 'react'
import { Camera, Search } from 'lucide-react'
import { formatCLP, formatKilo } from '@/lib/format'
import { CameraScanModal } from './CameraScanModal'
import type { CatalogEntry } from './useSaleCatalog'

export function ProductSearch({ catalog, onSelect }: { catalog: CatalogEntry[]; onSelect: (entry: CatalogEntry) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const results = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter(
        (c) => c.productName.toLowerCase().includes(q) || c.calidad.toLowerCase().includes(q) || c.sku?.toLowerCase() === q
      )
      .filter((c) => showOutOfStock || c.stock > 0)
      .sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0))
      .slice(0, 20)
  }, [catalog, term, showOutOfStock])

  function selectAndClear(entry: CatalogEntry) {
    onSelect(entry)
    setTerm('')
    setOpen(false)
    setSelected(new Set())
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

  // A USB barcode scanner types the code into whatever input is focused and
  // ends with Enter — if that matches a SKU exactly, add it straight to the
  // cart instead of requiring a manual click, same as a real POS scan.
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const code = term.trim().toLowerCase()
    if (!code) return
    const scanned = catalog.find((c) => c.sku?.toLowerCase() === code)
    if (scanned) selectAndClear(scanned)
  }

  function handleCameraDetect(code: string) {
    setScannerOpen(false)
    const scanned = catalog.find((c) => c.sku?.toLowerCase() === code.toLowerCase())
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

      {open && (term.trim() || results.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
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
      )}
    </div>
  )
}
