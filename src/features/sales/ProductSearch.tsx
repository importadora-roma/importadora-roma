import { useMemo, useState, type KeyboardEvent } from 'react'
import { Camera, Search } from 'lucide-react'
import { formatCLP, formatKilo } from '@/lib/format'
import { CameraScanModal } from './CameraScanModal'
import type { CatalogEntry } from './useSaleCatalog'

export function ProductSearch({ catalog, onSelect }: { catalog: CatalogEntry[]; onSelect: (entry: CatalogEntry) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const results = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter(
        (c) => c.productName.toLowerCase().includes(q) || c.calidad.toLowerCase().includes(q) || c.sku?.toLowerCase() === q
      )
      .slice(0, 20)
  }, [catalog, term])

  function selectAndClear(entry: CatalogEntry) {
    onSelect(entry)
    setTerm('')
    setOpen(false)
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

      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.variantId}
              onClick={() => selectAndClear(r)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span>
                <span className="font-medium text-slate-900">{r.productName}</span>
                <span className="text-slate-500"> — {r.calidad} {formatKilo(r.kilo)}</span>
              </span>
              <span className={`ml-4 shrink-0 ${r.stock <= 0 ? 'text-red-600' : 'text-slate-600'}`}>
                {formatCLP(r.price)} · stock {r.stock}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
