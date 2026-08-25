import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, Wallet, AlertTriangle, FileText, Boxes, Receipt } from 'lucide-react'
import { formatCLP } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useReports } from '@/features/reports/useReports'
import { useCash } from '@/features/cash/useCash'
import { useInventory } from '@/features/inventory/useInventory'
import { useProducts } from '@/features/products/useProducts'
import { useContainers } from '@/features/containers/useContainers'
import { useInvoices } from '@/features/invoices/useInvoices'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DashboardPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: effectiveBranchId, branch } = useEffectiveBranch()
  const isTienda = branch?.branch_type === 'tienda'

  const day = today()
  const { sales, loading: loadingSales } = useReports(effectiveBranchId, day, day)
  const { register, expectedNow } = useCash(effectiveBranchId)
  const { inventory } = useInventory()
  const { variants } = useProducts()

  const todayTotal = sales.reduce((s, sale) => s + sale.total, 0)

  const lowStockCount = useMemo(() => {
    if (!effectiveBranchId) return 0
    const activeVariantIds = new Set(variants.filter((v) => v.active).map((v) => v.id))
    return inventory.filter((i) => i.branch_id === effectiveBranchId && activeVariantIds.has(i.variant_id) && i.quantity <= 0).length
  }, [inventory, variants, effectiveBranchId])

  const canSeeCash = (profile?.role === 'admin' || profile?.role === 'supervisor') && !isTienda
  const canSeeContainers = (profile?.role === 'admin' || profile?.role === 'supervisor') && !isTienda
  const { containers } = useContainers(effectiveBranchId)
  const containersInCounting = containers.filter((c) => c.status === 'counting').length

  const canSeeInvoices = (profile?.role === 'admin' || profile?.role === 'supervisor') && !isTienda
  const { invoices } = useInvoices(effectiveBranchId)
  const pendingInvoices = invoices.filter((i) => i.status === 'pending').length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Panel</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bienvenido{profile?.full_name ? `, ${profile.full_name}` : ''}.
        {isTienda && ' Esta sucursal es una tienda: solo recibe stock por traslado, no tiene ventas ni caja en este sistema.'}
      </p>

      <div className="mt-6 grid grid-cols-4 gap-4">
        {!isTienda && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
              <ShoppingCart size={14} />
              Ventas de hoy
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-900">{loadingSales ? '—' : formatCLP(todayTotal)}</p>
            <p className="text-xs text-slate-400">{sales.length} ventas</p>
          </div>
        )}

        {canSeeCash && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
              <Wallet size={14} />
              Caja
            </div>
            {register ? (
              <>
                <p className="mt-2 text-xl font-semibold text-slate-900">{formatCLP(expectedNow)}</p>
                <p className="text-xs text-green-600">Abierta</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold text-slate-400">—</p>
                <p className="text-xs text-red-600">Cerrada</p>
              </>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
            <AlertTriangle size={14} />
            Sin stock
          </div>
          <p className={`mt-2 text-xl font-semibold ${lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{lowStockCount}</p>
          <p className="text-xs text-slate-400">variantes en 0 o negativo</p>
        </div>

        {canSeeContainers && (
          <Link
            to="/contenedores/activo"
            className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
              <Boxes size={14} />
              Contenedores en conteo
            </div>
            <p className={`mt-2 text-xl font-semibold ${containersInCounting > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {containersInCounting}
            </p>
            <p className="text-xs text-slate-400">en preparación o en conteo activo</p>
          </Link>
        )}

        {canSeeInvoices && (
          <Link to="/facturas" className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
              <Receipt size={14} />
              Facturas pendientes
            </div>
            <p className={`mt-2 text-xl font-semibold ${pendingInvoices > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{pendingInvoices}</p>
            <p className="text-xs text-slate-400">ventas esperando ser facturadas</p>
          </Link>
        )}

        {isTienda ? (
          <Link to="/transferencias" className="flex flex-col justify-center rounded-lg border border-slate-200 bg-slate-900 p-4 text-white hover:bg-slate-800">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText size={16} />
              Transferencias
            </div>
            <p className="mt-1 text-xs text-slate-300">Ver traslados recibidos</p>
          </Link>
        ) : (
          <Link to="/ventas" className="flex flex-col justify-center rounded-lg border border-slate-200 bg-slate-900 p-4 text-white hover:bg-slate-800">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText size={16} />
              Nueva venta
            </div>
            <p className="mt-1 text-xs text-slate-300">Registrar una venta ahora</p>
          </Link>
        )}
      </div>
    </div>
  )
}
