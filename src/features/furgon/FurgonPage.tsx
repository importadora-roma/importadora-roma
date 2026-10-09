import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, ArrowLeftRight, Wallet, Users, MapPin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { addDaysCL, formatCLP, formatKilo, formatTimeCL, todayCL } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'
import { useReports } from '@/features/reports/useReports'
import { useCommissionReport } from '@/features/reports/useCommissionReport'
import { useUsers } from '@/features/users/useUsers'
import { useSaleCatalog, type CatalogEntry } from '@/features/sales/useSaleCatalog'
import { ProductSearch } from '@/features/sales/ProductSearch'
import type { SalePaymentMethod } from '@/types/database'

const paymentLabels: Record<SalePaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
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

// A focused dashboard for a van/route-sales branch ("Furgón"): load what the
// rep took out, enter what they sold when they report back, and see stock,
// today's tally and commission owed — all scoped to whichever branch the
// topbar switcher has selected. Create the branch itself in Configuración →
// Sucursales (tipo: Importadora); this page isn't tied to one hardcoded name.
export function FurgonPage() {
  const navigate = useNavigate()
  const { branchId, branch, isAdmin } = useEffectiveBranch()
  const { products, variants, loading: loadingProducts } = useProducts()
  const { inventory, loading: loadingInventory, reload: reloadInventory } = useInventory()
  const { users } = useUsers()
  const { catalog } = useSaleCatalog(branchId)
  const [showAll, setShowAll] = useState(false)

  const from30 = addDaysCL(-30)
  const today = todayCL()
  const { sales, loading: loadingSales, reload: reloadSales } = useReports(branchId, from30, today)
  const { rows: commissionRows, loading: loadingCommission } = useCommissionReport(branchId, from30, today)

  // Quick sale entry — same create_sale RPC the full Ventas screen uses
  // (so stock, cash register and commission all stay consistent), just a
  // shorter form: no customer, one payment method for the whole sale, and a
  // "Vendedor" picker since the person entering this often isn't the one
  // who actually made the sale in the field.
  const [cart, setCart] = useState<QuickSaleLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>('efectivo')
  const [sellerId, setSellerId] = useState('')
  const [saleError, setSaleError] = useState<string | null>(null)
  const [saleSaving, setSaleSaving] = useState(false)
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null)

  const sellers = useMemo(
    () =>
      users
        .filter((u) => u.active && u.role !== 'admin')
        .sort((a, b) => (b.branch_id === branchId ? 1 : 0) - (a.branch_id === branchId ? 1 : 0)),
    [users, branchId]
  )

  // Re-pick a default seller whenever the branch changes, so switching
  // branches never leaves a stale seller from the previous one selected.
  useEffect(() => {
    setSellerId('')
  }, [branchId])

  useEffect(() => {
    if (sellerId || sellers.length === 0) return
    setSellerId(sellers[0].id)
  }, [sellers, sellerId])

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
    if (!branchId) {
      setSaleError('Selecciona una sucursal arriba primero')
      return
    }
    setSaleSaving(true)
    const { error } = await supabase.rpc('create_sale', {
      p_branch_id: branchId,
      p_customer_id: null,
      p_items: cart.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, sold_price: Number(i.price) })),
      p_payments: [{ payment_method: paymentMethod, amount: cartTotal }],
      p_notes: null,
      p_sale_date: todayCL(),
      p_user_id: sellerId || null,
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

  // Aggregate what's actually been sold today (across every sale of the
  // day, not just the ones entered from this tab), for the "2 Fashion
  // Verano, 3 Ropa de Casa" running tally.
  const [todayItems, setTodayItems] = useState<TodayItemSummary[]>([])
  const [loadingTodayItems, setLoadingTodayItems] = useState(false)
  const todaySaleIds = useMemo(() => sales.filter((s) => s.sale_date === today).map((s) => s.id), [sales, today])

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

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])

  const stockRows = useMemo(() => {
    return variants
      .filter((v) => v.active)
      .map((v) => ({
        variant: v,
        productName: productNameById.get(v.product_id) ?? '—',
        stock: inventory.find((i) => i.variant_id === v.id && i.branch_id === branchId)?.quantity ?? 0,
      }))
      .filter((r) => showAll || r.stock > 0)
      .sort((a, b) => b.stock - a.stock)
  }, [variants, inventory, branchId, productNameById, showAll])

  const totalFardos = stockRows.reduce((s, r) => s + Math.max(r.stock, 0), 0)
  const salesTotal = sales.reduce((s, sale) => s + sale.total, 0)
  const loading = loadingProducts || loadingInventory || loadingSales || loadingCommission

  return (
    <div>
      <div className="flex items-center gap-2">
        <MapPin className="text-slate-400" size={20} />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Furgón · Venta en terreno</h1>
          <p className="text-sm text-slate-500">
            {branch ? `Mostrando: ${branch.name}` : 'Sin sucursal seleccionada'}
            {isAdmin && ' — cambia de sucursal arriba si necesitas ver otro furgón.'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => navigate('/ventas')}>
          <ShoppingCart size={16} />
          Pantalla completa de ventas
        </Button>
        <Button variant="secondary" onClick={() => navigate('/transferencias')}>
          <ArrowLeftRight size={16} />
          Cargar stock (traslado)
        </Button>
        <Button variant="secondary" onClick={() => navigate('/caja')}>
          <Wallet size={16} />
          Caja
        </Button>
        <Button variant="secondary" onClick={() => navigate('/configuracion')}>
          <Users size={16} />
          Vendedores y comisión
        </Button>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Registrar lo vendido</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Ej: el vendedor volvió y reportó que vendió 2 Fashion Verano y 3 Ropa de Casa — agrégalos aquí y queda contabilizado.
        </p>

        <div className="mt-3">
          <ProductSearch catalog={catalog} onSelect={addToCart} branchId={branchId} />
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
            <label className="block text-xs font-medium text-slate-600">Vendedor</label>
            <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="mt-1">
              {sellers.length === 0 && <option value="">Sin vendedores registrados</option>}
              {sellers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </Select>
          </div>
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
      </div>

      {(loadingTodayItems || todayItems.length > 0) && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
        </div>
      )}

      {todaySaleIds.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
              {sales
                .filter((s) => s.sale_date === today)
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
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Fardos a bordo</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : totalFardos}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Ventas (últimos 30 días)</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : `${sales.length} · ${formatCLP(salesTotal)}`}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Comisión acumulada (30 días)</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {loading ? '—' : formatCLP(commissionRows.reduce((s, r) => s + r.commission, 0))}
          </p>
        </div>
      </div>

      {commissionRows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3 text-right"># Ventas</th>
                <th className="px-4 py-3 text-right">Ingresos</th>
                <th className="px-4 py-3 text-right">% Comisión</th>
                <th className="px-4 py-3 text-right">Comisión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commissionRows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.userName}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.salesCount}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatCLP(r.revenue)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.commissionPct}%</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCLP(r.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Mostrar también fardos sin stock
        </label>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Calidad</th>
              <th className="px-4 py-3">Kilo</th>
              <th className="px-4 py-3 text-right">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && stockRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Sin fardos cargados en esta sucursal todavía. Usa "Cargar stock" para traer fardos desde un depósito.
                </td>
              </tr>
            )}
            {stockRows.map((r) => (
              <tr key={r.variant.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{r.productName}</td>
                <td className="px-4 py-3 text-slate-600">{r.variant.calidad}</td>
                <td className="px-4 py-3 text-slate-600">{formatKilo(r.variant.kilo)}</td>
                <td className={`px-4 py-3 text-right ${r.stock <= 0 ? 'text-red-600' : 'text-slate-900'}`}>{r.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
