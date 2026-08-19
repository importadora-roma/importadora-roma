import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatCLP, formatKilo } from '@/lib/format'
import type { CatalogEntry } from './useSaleCatalog'

export function ProductSearch({ catalog, onSelect }: { catalog: CatalogEntry[]; onSelect: (entry: CatalogEntry) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)

  const results = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return []
    return catalog
      .filter((c) => c.productName.toLowerCase().includes(q) || c.calidad.toLowerCase().includes(q))
      .slice(0, 20)
  }, [catalog, term])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar producto por nombre o calidad..."
          className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.variantId}
              onClick={() => {
                onSelect(r)
                setTerm('')
                setOpen(false)
              }}
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
