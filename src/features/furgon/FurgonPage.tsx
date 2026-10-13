import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, PackagePlus, PackageMinus, FileDown, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { addDaysCL, formatCLP, formatKilo, formatTimeCL, todayCL } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useBranches } from '@/features/branches/useBranches'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'
import { useSaleCatalog, type CatalogEntry } from '@/features/sales/useSaleCatalog'
import { ProductSearch } from '@/features/sales/ProductSearch'
import { useTransfers, type Transfer, type TransferItem } from '@/features/transfers/useTransfers'
import { generateTransferPdf } from '@/features/transfers/transferPdf'
import { useTerrenoSales } from './useTerrenoSales'
import type { SalePaymentMethod } from '@/types/database'

const paymentLabels: Record<SalePaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
}

const DRIVER_NAME_KEY = 'furgon_driver_name'

interface MoveLine {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  quantity: number
  unitPrice: string
}

// Loading the van: moves stock OUT of a real branch and INTO the Furgón
// branch via furgon_load_stock, a one-step transfer that's also recorded
// in Transferencias like any other (auditable, and the existing "Guía de
// traslado" PDF works for it unmodified — just relabeled here).
function LoadStockModal({
  open,
  onClose,
  branches,
  onDone,
}: {
  open: boolean
  onClose: () => void
  branches: { id: string; name: string; address: string | null }[]
  onDone: () => void
}) {
  const [originBranchId, setOriginBranchId] = useState(branches[0]?.id ?? '')
  const { catalog } = useSaleCatalog(originBranchId)
  const [lines, setLines] = useState<MoveLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setOriginBranchId(branches[0]?.id ?? '')
      setLines([])
      setError(null)
    }
  }, [open, branches])

  function addLine(entry: CatalogEntry) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === entry.variantId)
      if (existing) return prev.map((l) => (l.variantId === entry.variantId ? { ...l, quantity: l.quantity + 1 } : l))
      return [...prev, { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, quantity: 1, unitPrice: String(entry.price) }]
    })
  }

  function updateLine(variantId: string, patch: Partial<MoveLine>) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)))
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }

  async function handleSubmit() {
    setError(null)
    if (!originBranchId) {
      setError('Selecciona la sucursal de origen')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('furgon_load_stock', {
      p_origin_branch_id: originBranchId,
      p_items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, unit_price: Number(l.unitPrice) || null })),
      p_notes: null,
    })
    if (rpcError) {
      setSaving(false)
      setError(rpcError.message)
      return
    }

    const transferId = data as string
    const origin = branches.find((b) => b.id === originBranchId)
    const { data: transferRow } = await supabase.from('transfers').select('*').eq('id', transferId).single()
    const { data: itemRows } = await supabase.from('transfer_items').select('*').eq('transfer_id', transferId)
    setSaving(false)

    if (transferRow && origin) {
      // variantLabel is built from the lines just submitted — cheap, no refetch needed.
      const labelByVariant = new Map(lines.map((l) => [l.variantId, `${l.productName} — ${l.calidad}${l.kilo ? ` ${formatKilo(l.kilo)}` : ''}`]))
      await generateTransferPdf(transferRow as unknown as Transfer, (itemRows ?? []) as unknown as TransferItem[], {
        originName: origin.name,
        originAddress: origin.address,
        destinationName: 'Furgón',
        variantLabel: (variantId) => labelByVariant.get(variantId) ?? '—',
        title: 'Guía de despacho',
      })
    }

    onDone()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Cargar stock al furgón">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Sucursal de origen</label>
          <Select value={originBranchId} onChange={(e) => setOriginBranchId(e.target.value)} className="mt-1">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <ProductSearch catalog={catalog} onSelect={addLine} branchId={originBranchId} />

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2">Cant.</th>
                  <th className="py-1 pr-2">Precio</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.variantId}>
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-slate-900">{l.productName}</span>
                      <span className="text-slate-500"> — {l.calidad} {formatKilo(l.kilo)}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.variantId, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.variantId, { unitPrice: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5">
                      <button onClick={() => removeLine(l.variantId)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || lines.length === 0}>
            {saving ? 'Cargando...' : 'Cargar y generar guía'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Unloading the van: the reverse — fardos the vendedor didn't sell going
// back into a real branch's stock. Capped to what's actually on the van.
function UnloadStockModal({
  open,
  onClose,
  branches,
  furgonBranchId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  branches: { id: string; name: string; address: string | null }[]
  furgonBranchId: string
  onDone: () => void
}) {
  const [destinationBranchId, setDestinationBranchId] = useState(branches[0]?.id ?? '')
  const { catalog } = useSaleCatalog(furgonBranchId)
  const [lines, setLines] = useState<MoveLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDestinationBranchId(branches[0]?.id ?? '')
      setLines([])
      setError(null)
    }
  }, [open, branches])

  function addLine(entry: CatalogEntry) {
    if (entry.stock <= 0) return
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === entry.variantId)
      if (existing) {
        if (existing.quantity >= entry.stock) return prev
        return prev.map((l) => (l.variantId === entry.variantId ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, quantity: 1, unitPrice: String(entry.price) }]
    })
  }

  function updateLineQty(variantId: string, quantity: number, max: number) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(Math.max(1, quantity), max) } : l)))
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }

  async function handleSubmit() {
    setError(null)
    if (!destinationBranchId) {
      setError('Selecciona la sucursal de destino')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('furgon_unload_stock', {
      p_destination_branch_id: destinationBranchId,
      p_items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
      p_notes: null,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    onDone()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Descargar stock del furgón">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Sucursal de destino</label>
          <Select value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)} className="mt-1">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        <ProductSearch catalog={catalog} onSelect={addLine} branchId={furgonBranchId} />

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2">Cant.</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => {
                  const max = catalog.find((c) => c.variantId === l.variantId)?.stock ?? l.quantity
                  return (
                    <tr key={l.variantId}>
                      <td className="py-1.5 pr-2">
                        <span className="font-medium text-slate-900">{l.productName}</span>
                        <span className="text-slate-500"> — {l.calidad} {formatKilo(l.kilo)}</span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          type="number"
                          min={1}
                          max={max}
                          value={l.quantity}
                          onChange={(e) => updateLineQty(l.variantId, Number(e.target.value), max)}
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="ml-1 text-xs text-slate-400">/ {max}</span>
                      </td>
                      <td className="py-1.5">
                        <button onClick={() => removeLine(l.variantId)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || lines.length === 0}>
            {saving ? 'Descargando...' : 'Descargar del furgón'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface QuickSaleLine {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  price: string
  quantity: number
}

interface TodayItemSummary {
  key: string
  label: string
  quantity: number
}

// The Furgón tab: a dedicated branch's worth of stock (what's physically
// loaded on the van right now, nothing else — not a store's full catalog),
// a simple way to load/unload it, and a quick form for entering what the
// driver reports selling. Sales here are tagged is_terreno — same flag a
// regular Ventas-screen "Vendido en terreno" checkbox sets — so this feed
// and the Furgón's own branch stay in sync with the rest of the system
// regardless of which screen a terreno sale was entered from.
export function FurgonPage() {
  const navigate = useNavigate()
  const { branches, loading: loadingBranches } = useBranches()
  const furgonBranch = branches.find((b) => b.is_furgon) ?? null
  const furgonBranchId = furgonBranch?.id ?? ''
  const otherBranches = useMemo(() => branches.filter((b) => !b.is_furgon && b.active), [branches])

  const { products, variants, loading: loadingProducts } = useProducts()
  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const { inventory, loading: loadingInventory, reload: reloadInventory } = useInventory()
  const { catalog } = useSaleCatalog(furgonBranchId)
  const { loadTransferItems } = useTransfers()

  const from30 = addDaysCL(-30)
  const today = todayCL()
  const { sales, loading: loadingSales, reload: reloadSales } = useTerrenoSales(from30, today)

  const [driverName, setDriverName] = useState('')
  useEffect(() => {
    setDriverName(localStorage.getItem(DRIVER_NAME_KEY) ?? '')
  }, [])
  useEffect(() => {
    try {
      if (driverName) localStorage.setItem(DRIVER_NAME_KEY, driverName)
    } catch {
      // ignore — purely a convenience default, not critical state
    }
  }, [driverName])

  const [cart, setCart] = useState<QuickSaleLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>('efectivo')
  const [saleError, setSaleError] = useState<string | null>(null)
  const [saleSaving, setSaleSaving] = useState(false)
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null)

  const [loadOpen, setLoadOpen] = useState(false)
  const [unloadOpen, setUnloadOpen] = useState(false)

  interface MovementRow {
    id: string
    transfer_number: string | null
    kind: 'load' | 'unload'
    otherBranchName: string
    sent_at: string
  }
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loadingMovements, setLoadingMovements] = useState(false)

  async function reloadMovements() {
    if (!furgonBranchId) return
    setLoadingMovements(true)
    const { data } = await supabase
      .from('transfers')
      .select('id, transfer_number, origin_branch_id, destination_branch_id, sent_at')
      .or(`origin_branch_id.eq.${furgonBranchId},destination_branch_id.eq.${furgonBranchId}`)
      .order('sent_at', { ascending: false })
      .limit(10)
    const branchNameById = new Map(branches.map((b) => [b.id, b.name]))
    setMovements(
      (data ?? []).map((t) => ({
        id: t.id as string,
        transfer_number: t.transfer_number as string | null,
        kind: (t.destination_branch_id as string) === furgonBranchId ? 'load' : 'unload',
        otherBranchName:
          branchNameById.get((t.destination_branch_id as string) === furgonBranchId ? (t.origin_branch_id as string) : (t.destination_branch_id as string)) ?? '—',
        sent_at: t.sent_at as string,
      }))
    )
    setLoadingMovements(false)
  }

  useEffect(() => {
    reloadMovements()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furgonBranchId])

  async function reprintGuide(movementId: string) {
    const { items, error } = await loadTransferItems(movementId)
    if (error) return
    const { data: transferRow } = await supabase.from('transfers').select('*').eq('id', movementId).single()
    if (!transferRow) return
    const t = transferRow as unknown as Transfer
    const origin = branches.find((b) => b.id === t.origin_branch_id)
    const destination = branches.find((b) => b.id === t.destination_branch_id)
    const variantLabelById = new Map(
      variants.map((v) => [v.id, `${productNameById.get(v.product_id) ?? '—'} — ${v.calidad}${v.kilo ? ` ${formatKilo(v.kilo)}` : ''}`])
    )
    await generateTransferPdf(t, items, {
      originName: origin?.name ?? '—',
      originAddress: origin?.address ?? null,
      destinationName: destination?.name ?? '—',
      variantLabel: (variantId) => variantLabelById.get(variantId) ?? '—',
      title: 'Guía de despacho',
    })
  }

  function addToCart(entry: CatalogEntry) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === entry.variantId)
      if (existing) return prev.map((i) => (i.variantId === entry.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      return [
        ...prev,
        { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, price: String(entry.price), quantity: 1 },
      ]
    })
  }

  function updateCartLine(variantId: string, patch: Partial<QuickSaleLine>) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, ...patch } : i)))
  }

  function removeCartLine(variantId: string) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  const cartTotal = cart.reduce((s, i) => s + (Number(i.price) || 0) * i.quantity, 0)

  async function handleRegisterSale() {
    setSaleError(null)
    setSaleSuccess(null)
    if (cart.length === 0) {
      setSaleError('Agrega al menos un producto')
      return
    }
    if (cartTotal <= 0) {
      setSaleError('Ingresa precios válidos')
      return
    }
    if (!furgonBranchId) {
      setSaleError('No existe la sucursal del furgón todavía')
      return
    }
    setSaleSaving(true)
    const { error } = await supabase.rpc('create_sale', {
      p_branch_id: furgonBranchId,
      p_customer_id: null,
      p_items: cart.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, sold_price: Number(i.price) })),
      p_payments: [{ payment_method: paymentMethod, amount: cartTotal }],
      p_notes: null,
      p_sale_date: todayCL(),
      p_is_terreno: true,
      p_driver_name: driverName.trim() || null,
    })
    setSaleSaving(false)
    if (error) {
      setSaleError(error.message)
      return
    }
    setCart([])
    setSaleSuccess('Venta registrada.')
    await Promise.all([reloadInventory(), reloadSales()])
  }

  const todaySales = useMemo(() => sales.filter((s) => s.sale_date === today), [sales, today])
  const todaySaleIds = useMemo(() => todaySales.map((s) => s.id), [todaySales])

  const [todayItems, setTodayItems] = useState<TodayItemSummary[]>([])
  const [loadingTodayItems, setLoadingTodayItems] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (todaySaleIds.length === 0) {
        setTodayItems([])
        return
      }
      setLoadingTodayItems(true)
      const { data } = await supabase
        .from('sale_items')
        .select('variant_id, custom_name, quantity')
        .in('sale_id', todaySaleIds)
        .eq('status', 'active')
      if (cancelled) return
      const byKey = new Map<string, TodayItemSummary>()
      for (const row of (data ?? []) as { variant_id: string | null; custom_name: string | null; quantity: number }[]) {
        const variant = row.variant_id ? variants.find((v) => v.id === row.variant_id) : null
        const key = row.variant_id ?? `custom:${row.custom_name}`
        const label = variant
          ? `${productNameById.get(variant.product_id) ?? '—'} — ${variant.calidad} ${formatKilo(variant.kilo)}`
          : row.custom_name ?? '—'
        const entry = byKey.get(key) ?? { key, label, quantity: 0 }
        entry.quantity += row.quantity
        byKey.set(key, entry)
      }
      setTodayItems(Array.from(byKey.values()).sort((a, b) => b.quantity - a.quantity))
      setLoadingTodayItems(false)
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySaleIds.join(','), variants])

  const stockRows = useMemo(() => {
    if (!furgonBranchId) return []
    return variants
      .filter((v) => v.active)
      .map((v) => ({
        variant: v,
        productName: productNameById.get(v.product_id) ?? '—',
        stock: inventory.find((i) => i.variant_id === v.id && i.branch_id === furgonBranchId)?.quantity ?? 0,
      }))
      .filter((r) => r.stock > 0)
      .sort((a, b) => b.stock - a.stock)
  }, [variants, inventory, furgonBranchId, productNameById])

  const totalFardos = stockRows.reduce((s, r) => s + r.stock, 0)
  const totalStockValue = stockRows.reduce((s, r) => s + r.stock * r.variant.price, 0)
  const salesTotal = sales.reduce((s, sale) => s + sale.total, 0)
  const loading = loadingProducts || loadingInventory || loadingSales || loadingBranches

  if (!loadingBranches && !furgonBranch) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Furgón</h1>
        <p className="mt-2 text-sm text-red-600">
          No existe todavía la sucursal del furgón. Aplica la migración 0060 en Supabase y recarga esta página.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <MapPin className="text-slate-400" size={20} />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Furgón</h1>
          <p className="text-sm text-slate-500">Lo que está cargado en el furgón en este momento.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Fardos a bordo</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : totalFardos}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Valor del stock a bordo</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : formatCLP(totalStockValue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Vendido en terreno (30 días)</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : `${sales.length} · ${formatCLP(salesTotal)}`}</p>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setLoadOpen(true)} disabled={!furgonBranchId}>
          <PackagePlus size={16} />
          Cargar stock
        </Button>
        <Button variant="secondary" onClick={() => setUnloadOpen(true)} disabled={!furgonBranchId || stockRows.length === 0}>
          <PackageMinus size={16} />
          Descargar stock
        </Button>
        <Button variant="secondary" onClick={() => navigate('/ventas')}>
          Pantalla completa de ventas
        </Button>
      </div>

      <Card className="mt-4 overflow-x-auto">
        <p className="px-4 pt-3 text-sm font-medium text-slate-700">Fardos a bordo del furgón</p>
        <table className="mt-1 w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Calidad</th>
              <th className="px-4 py-3">Kilo</th>
              <th className="px-4 py-3 text-right">Cantidad</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && stockRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  El furgón no tiene fardos cargados todavía. Usa "Cargar stock" para traer fardos desde una sucursal.
                </td>
              </tr>
            )}
            {stockRows.map((r) => (
              <tr key={r.variant.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{r.productName}</td>
                <td className="px-4 py-3 text-slate-600">{r.variant.calidad}</td>
                <td className="px-4 py-3 text-slate-600">{formatKilo(r.variant.kilo)}</td>
                <td className="px-4 py-3 text-right text-slate-900">{r.stock}</td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCLP(r.stock * r.variant.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {movements.length > 0 && (
        <Card className="mt-4 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Movimientos recientes</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Sucursal</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingMovements && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loadingMovements &&
                movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 text-slate-500">{formatTimeCL(m.sent_at)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={m.kind === 'load' ? 'brand' : 'gold'}>{m.kind === 'load' ? 'Carga' : 'Descarga'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{m.otherBranchName}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => reprintGuide(m.id)} className="text-slate-400 hover:text-slate-700" title="Imprimir guía">
                        <FileDown size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6 p-4">
        <p className="text-sm font-medium text-slate-700">Registrar lo vendido</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Ej: el vendedor volvió y reportó que vendió 2 Fashion Verano y 3 Ropa de Casa — agrégalos aquí y queda contabilizado
          (se marca automáticamente como "Vendido en terreno" y descuenta del stock del furgón).
        </p>

        <div className="mt-3 max-w-xs">
          <Input
            label="Vendedor del furgón"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder="Nombre de quien vende"
          />
        </div>

        <div className="mt-3">
          <ProductSearch catalog={catalog} onSelect={addToCart} branchId={furgonBranchId} />
        </div>

        {cart.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2">Cant.</th>
                  <th className="py-1 pr-2">Precio</th>
                  <th className="py-1 pr-2">Subtotal</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.map((line) => (
                  <tr key={line.variantId}>
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-slate-900">{line.productName}</span>
                      <span className="text-slate-500"> — {line.calidad} {formatKilo(line.kilo)}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateCartLine(line.variantId, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        value={line.price}
                        onChange={(e) => updateCartLine(line.variantId, { price: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2 font-medium text-slate-900">{formatCLP((Number(line.price) || 0) * line.quantity)}</td>
                    <td className="py-1.5">
                      <button onClick={() => removeCartLine(line.variantId)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">Método de pago</label>
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as SalePaymentMethod)} className="mt-1">
              {(['efectivo', 'tarjeta', 'transferencia'] as SalePaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {paymentLabels[m]}
                </option>
              ))}
            </Select>
          </div>
          <div className="text-sm text-slate-600">
            Total: <span className="font-semibold text-slate-900">{formatCLP(cartTotal)}</span>
          </div>
          <Button onClick={handleRegisterSale} disabled={saleSaving || cart.length === 0}>
            {saleSaving ? 'Registrando...' : 'Registrar venta'}
          </Button>
        </div>

        {saleError && <p className="mt-2 text-sm text-red-600">{saleError}</p>}
        {saleSuccess && <p className="mt-2 text-sm text-emerald-600">{saleSuccess}</p>}
      </Card>

      {(loadingTodayItems || todayItems.length > 0) && (
        <Card className="mt-6 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Vendido hoy</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingTodayItems && (
                <tr>
                  <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loadingTodayItems &&
                todayItems.map((item) => (
                  <tr key={item.key}>
                    <td className="px-4 py-2.5 text-slate-900">{item.label}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{item.quantity}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {todaySales.length > 0 && (
        <Card className="mt-4 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Ventas de hoy</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Hora</th>
                <th className="px-4 py-3">Folio</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {todaySales
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 text-slate-600">{formatTimeCL(s.created_at)}</td>
                    <td className="px-4 py-2.5 text-slate-900">{s.sale_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCLP(s.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {furgonBranchId && (
        <>
          <LoadStockModal
            open={loadOpen}
            onClose={() => setLoadOpen(false)}
            branches={otherBranches}
            onDone={() => {
              reloadInventory()
              reloadMovements()
            }}
          />
          <UnloadStockModal
            open={unloadOpen}
            onClose={() => setUnloadOpen(false)}
            branches={otherBranches}
            furgonBranchId={furgonBranchId}
            onDone={() => {
              reloadInventory()
              reloadMovements()
            }}
          />
        </>
      )}
    </div>
  )
}
