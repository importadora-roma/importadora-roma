import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Users, Package, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCLP } from '@/lib/format'

interface CustomerHit {
  id: string
  name: string
  rut: string | null
}

interface ProductHit {
  id: string
  name: string
}

interface SaleHit {
  id: string
  sale_number: string | null
  total: number
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [customers, setCustomers] = useState<CustomerHit[]>([])
  const [products, setProducts] = useState<ProductHit[]>([])
  const [sales, setSales] = useState<SaleHit[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = term.trim()
    if (q.length < 2) {
      setCustomers([])
      setProducts([])
      setSales([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const [customersRes, productsRes, salesRes] = await Promise.all([
        supabase.from('customers').select('id, name, rut').or(`name.ilike.%${q}%,rut.ilike.%${q}%`).is('deleted_at', null).limit(5),
        supabase.from('products').select('id, name').ilike('name', `%${q}%`).is('deleted_at', null).limit(5),
        supabase.from('sales').select('id, sale_number, total').ilike('sale_number', `%${q}%`).limit(5),
      ])
      setCustomers((customersRes.data ?? []) as unknown as CustomerHit[])
      setProducts((productsRes.data ?? []) as unknown as ProductHit[])
      setSales((salesRes.data ?? []) as unknown as SaleHit[])
    }, 250)
  }, [term])

  const hasResults = customers.length + products.length + sales.length > 0

  function close() {
    setOpen(false)
    setTerm('')
  }

  function goTo(path: string) {
    navigate(path)
    close()
  }

  return (
    <div className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar cliente, producto, venta..."
          className="w-full rounded-md border border-slate-300 py-1.5 pl-9 pr-3 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      {open && term.trim().length >= 2 && (
        <>
          <button aria-label="Cerrar búsqueda" onClick={close} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            {!hasResults && <p className="px-4 py-6 text-center text-sm text-slate-400">Sin resultados.</p>}

            {customers.length > 0 && (
              <div className="border-b border-slate-100 px-2 py-2">
                <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase text-slate-400">
                  <Users size={12} /> Clientes
                </div>
                {customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => goTo('/clientes')}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">{c.name}</span>
                    {c.rut && <span className="text-slate-400"> · {c.rut}</span>}
                  </button>
                ))}
              </div>
            )}

            {products.length > 0 && (
              <div className="border-b border-slate-100 px-2 py-2">
                <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase text-slate-400">
                  <Package size={12} /> Productos
                </div>
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => goTo('/inventario')}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-900 hover:bg-slate-50"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            {sales.length > 0 && (
              <div className="px-2 py-2">
                <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase text-slate-400">
                  <Receipt size={12} /> Ventas
                </div>
                {sales.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => goTo('/ventas')}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">{s.sale_number}</span>
                    <span className="text-slate-500">{formatCLP(s.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
