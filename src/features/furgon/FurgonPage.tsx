import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, ArrowLeftRight, Wallet, Users, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatCLP, formatKilo, todayCL } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'
import { useReports } from '@/features/reports/useReports'
import { useCommissionReport } from '@/features/reports/useCommissionReport'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// A focused dashboard for a van/route-sales branch ("Furgón"): what's
// currently loaded, what it's sold lately, and what's owed in commission —
// everything else (actually selling, loading stock, cash) is the same
// Ventas/Transferencias/Caja screens every other branch already uses,
// just scoped to whichever branch the topbar switcher has selected. Create
// the branch itself in Configuración → Sucursales (tipo: Importadora) —
// this page works for any branch, not just one hardcoded name.
export function FurgonPage() {
  const navigate = useNavigate()
  const { branchId, branch, isAdmin } = useEffectiveBranch()
  const { products, variants, loading: loadingProducts } = useProducts()
  const { inventory, loading: loadingInventory } = useInventory()
  const [showAll, setShowAll] = useState(false)

  const from30 = daysAgo(30)
  const today = todayCL()
  const { sales, loading: loadingSales } = useReports(branchId, from30, today)
  const { rows: commissionRows, loading: loadingCommission } = useCommissionReport(branchId, from30, today)

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
        <Button onClick={() => navigate('/ventas')}>
          <ShoppingCart size={16} />
          Nueva venta
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
