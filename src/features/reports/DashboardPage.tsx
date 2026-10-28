import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wallet, AlertTriangle, FileText, Boxes, Receipt, Banknote, ArrowRight, ShieldAlert, Truck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatDateTime, formatVariantSpec, todayCL } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useReports } from '@/features/reports/useReports'
import { useCash } from '@/features/cash/useCash'
import { useInventory } from '@/features/inventory/useInventory'
import { useProducts } from '@/features/products/useProducts'
import { useContainers } from '@/features/containers/useContainers'
import { useInvoices } from '@/features/invoices/useInvoices'
import { usePendingApprovals } from '@/features/approvals/useApprovalRequests'
import { useTransfers, type Transfer, type TransferItem } from '@/features/transfers/useTransfers'
import { useBranches } from '@/features/branches/useBranches'
import type { PaymentMethod } from '@/types/database'

const approvalTypeLabels: Record<string, string> = {
  price_change: 'Cambio de precio',
  product_delete: 'Eliminación de producto/variante',
  cash_adjustment: 'Movimiento de caja',
  sale_item_exchange: 'Cambio de producto en una venta',
  sale_item_return: 'Devolución en una venta',
}

// Dashboard is loaded eagerly (see App.tsx) — this chart section pulls in
// recharts, so it's lazy-loaded on its own to keep that out of the main
// bundle, same as ReportsPage.tsx already gets lazy-loaded as a route.
const BranchSalesOverview = lazy(() => import('./BranchSalesOverview').then((m) => ({ default: m.BranchSalesOverview })))
const DailyFinancialSummary = lazy(() => import('./DailyFinancialSummary').then((m) => ({ default: m.DailyFinancialSummary })))

type ChipTone = 'brand' | 'emerald' | 'amber' | 'red' | 'slate'

const chipToneClasses: Record<ChipTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-500',
}

function KpiLabel({ icon: Icon, tone, children }: { icon: typeof Banknote; tone: ChipTone; children: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chipToneClasses[tone]}`}>
        <Icon size={16} />
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{children}</p>
    </div>
  )
}

export function DashboardPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: effectiveBranchId, branch } = useEffectiveBranch()
  const isTienda = branch?.branch_type === 'tienda'

  const day = todayCL()
  const { sales, payments: todayPayments, loading: loadingSales } = useReports(effectiveBranchId, day, day)
  const { register, expectedNow } = useCash(effectiveBranchId)
  const { inventory } = useInventory()
  const { variants, products } = useProducts()

  const todayTotal = sales.reduce((s, sale) => s + sale.total, 0)

  const todayByMethod = useMemo(() => {
    const totals: Record<PaymentMethod, number> = { efectivo: 0, tarjeta: 0, transferencia: 0 }
    for (const p of todayPayments) totals[p.payment_method] += p.amount
    return totals
  }, [todayPayments])

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

  const isAdmin = profile?.role === 'admin'
  const { requests: pendingApprovals, approve, reject } = usePendingApprovals(isAdmin)
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  async function handleApprove(id: string) {
    setProcessingApprovalId(id)
    const { error } = await approve(id)
    setProcessingApprovalId(null)
    setApprovalError(error)
  }

  async function handleReject(id: string) {
    setProcessingApprovalId(id)
    const { error } = await reject(id)
    setProcessingApprovalId(null)
    setApprovalError(error)
  }

  const canManageTransfers = profile?.role === 'admin' || profile?.role === 'supervisor'
  const { transfers, loadTransferItems, receiveTransfer, cancelTransfer } = useTransfers(canManageTransfers)
  const { branches: allBranches } = useBranches()
  const branchNameById = useMemo(() => new Map(allBranches.map((b) => [b.id, b.name])), [allBranches])
  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])

  function variantLabel(variantId: string): string {
    const variant = variantById.get(variantId)
    if (!variant) return '—'
    return `${productNameById.get(variant.product_id) ?? '—'} — ${formatVariantSpec(variant.calidad, variant.kilo)}`
  }

  const pendingTransfers = useMemo(
    () => transfers.filter((t) => t.status === 'en_transito' && t.destination_branch_id === effectiveBranchId),
    [transfers, effectiveBranchId]
  )

  const [transferItemsCache, setTransferItemsCache] = useState<Record<string, TransferItem[]>>({})
  const [processingTransferId, setProcessingTransferId] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [rejectTransferTarget, setRejectTransferTarget] = useState<Transfer | null>(null)

  useEffect(() => {
    const missing = pendingTransfers.filter((t) => !(t.id in transferItemsCache))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map(async (t) => [t.id, (await loadTransferItems(t.id)).items] as const)).then((pairs) => {
      if (cancelled) return
      setTransferItemsCache((prev) => {
        const next = { ...prev }
        for (const [id, items] of pairs) next[id] = items
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTransfers, transferItemsCache])

  async function handleReceiveTransfer(id: string) {
    setProcessingTransferId(id)
    const { error } = await receiveTransfer(id)
    setProcessingTransferId(null)
    setTransferError(error)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Panel</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bienvenido{profile?.full_name ? `, ${profile.full_name}` : ''}.
        {isTienda && ' Esta sucursal es una tienda: solo recibe stock por traslado, no tiene ventas ni caja en este sistema.'}
      </p>

      {isAdmin && pendingApprovals.length > 0 && (
        <Card className="mt-6 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-900">
              Solicitudes pendientes de aprobación ({pendingApprovals.length})
            </h2>
          </div>
          {approvalError && <p className="mt-2 text-sm text-red-600">{approvalError}</p>}
          <div className="mt-3 space-y-3">
            {pendingApprovals.map((req) => (
              <div key={req.id} className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                  {approvalTypeLabels[req.request_type] ?? req.request_type}
                </p>
                <p className="mt-1 text-sm text-slate-700">{req.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {req.requesterName ?? 'Usuario'} · {req.branchName ?? 'Sucursal'} · {formatDateTime(req.created_at)}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={processingApprovalId === req.id}
                    onClick={() => handleReject(req.id)}
                  >
                    Rechazar
                  </Button>
                  <Button disabled={processingApprovalId === req.id} onClick={() => handleApprove(req.id)}>
                    Aprobar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {canManageTransfers && pendingTransfers.length > 0 && (
        <Card className="mt-6 border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-sky-600" />
            <h2 className="text-sm font-semibold text-sky-900">Traslados por recibir ({pendingTransfers.length})</h2>
          </div>
          {transferError && <p className="mt-2 text-sm text-red-600">{transferError}</p>}
          <div className="mt-3 space-y-3">
            {pendingTransfers.map((t) => {
              const items = transferItemsCache[t.id] ?? []
              return (
                <div key={t.id} className="rounded-lg border border-sky-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-800">
                    Desde {branchNameById.get(t.origin_branch_id) ?? 'Sucursal'}
                    {t.transfer_number ? ` · ${t.transfer_number}` : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                    {items.length === 0 && <li className="text-slate-400">Cargando artículos...</li>}
                    {items.map((item) => (
                      <li key={item.id}>
                        {item.quantity} x {variantLabel(item.variant_id)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(t.sent_at)}</p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      disabled={processingTransferId === t.id}
                      onClick={() => setRejectTransferTarget(t)}
                    >
                      Rechazar
                    </Button>
                    <Button disabled={processingTransferId === t.id} onClick={() => handleReceiveTransfer(t.id)}>
                      Recibir
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <ReasonModal
        open={!!rejectTransferTarget}
        onClose={() => setRejectTransferTarget(null)}
        title={`Rechazar traslado${rejectTransferTarget?.transfer_number ? ` ${rejectTransferTarget.transfer_number}` : ''}`}
        confirmLabel="Rechazar"
        onConfirm={async (reason) => {
          const result = await cancelTransfer(rejectTransferTarget!.id, reason)
          if (!result.error) setRejectTransferTarget(null)
          return result
        }}
      />

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {!isTienda && (
          <Card className="p-4">
            <KpiLabel icon={Banknote} tone="emerald">
              Ventas de hoy
            </KpiLabel>
            {loadingSales ? (
              <p className="mt-2 text-xl font-semibold text-slate-400">—</p>
            ) : (
              <div className="mt-2 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Efectivo</span>
                  <span className="font-medium text-slate-900">{formatCLP(todayByMethod.efectivo)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tarjeta</span>
                  <span className="font-medium text-slate-900">{formatCLP(todayByMethod.tarjeta)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transferencia</span>
                  <span className="font-medium text-slate-900">{formatCLP(todayByMethod.transferencia)}</span>
                </div>
                <div className="mt-1.5 flex justify-between border-t border-slate-100 pt-1.5">
                  <span className="font-medium text-slate-700">Total</span>
                  <span className="font-semibold text-slate-900">{formatCLP(todayTotal)}</span>
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">{sales.length} ventas</p>
          </Card>
        )}

        {canSeeCash && (
          <Card className="p-4">
            <KpiLabel icon={Wallet} tone={register ? 'brand' : 'slate'}>
              Caja
            </KpiLabel>
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
          </Card>
        )}

        <Card className="p-4">
          <KpiLabel icon={AlertTriangle} tone={lowStockCount > 0 ? 'red' : 'slate'}>
            Sin stock
          </KpiLabel>
          <p className={`mt-2 text-xl font-semibold ${lowStockCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{lowStockCount}</p>
          <p className="text-xs text-slate-400">variantes en 0 o negativo</p>
        </Card>

        {canSeeContainers && (
          <Link
            to="/contenedores/activo"
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:border-slate-300 hover:shadow-md"
          >
            <KpiLabel icon={Boxes} tone={containersInCounting > 0 ? 'amber' : 'slate'}>
              Contenedores en conteo
            </KpiLabel>
            <p className={`mt-2 text-xl font-semibold ${containersInCounting > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {containersInCounting}
            </p>
            <p className="text-xs text-slate-400">en preparación o en conteo activo</p>
          </Link>
        )}

        {canSeeInvoices && (
          <Link
            to="/facturas"
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:border-slate-300 hover:shadow-md"
          >
            <KpiLabel icon={Receipt} tone={pendingInvoices > 0 ? 'amber' : 'slate'}>
              Facturas pendientes
            </KpiLabel>
            <p className={`mt-2 text-xl font-semibold ${pendingInvoices > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{pendingInvoices}</p>
            <p className="text-xs text-slate-400">ventas esperando ser facturadas</p>
          </Link>
        )}

        {isTienda ? (
          <Link
            to="/transferencias"
            className="group flex flex-col justify-center rounded-lg bg-gradient-to-br from-brand-800 to-brand-950 p-4 text-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2">
                <FileText size={16} className="text-gold-400" />
                Transferencias
              </span>
              <ArrowRight size={14} className="text-white/40 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-1 text-xs text-brand-200">Ver traslados recibidos</p>
          </Link>
        ) : (
          <Link
            to="/ventas"
            className="group flex flex-col justify-center rounded-lg bg-gradient-to-br from-brand-800 to-brand-950 p-4 text-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2">
                <FileText size={16} className="text-gold-400" />
                Nueva venta
              </span>
              <ArrowRight size={14} className="text-white/40 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-1 text-xs text-brand-200">Registrar una venta ahora</p>
          </Link>
        )}
      </div>

      {canSeeCash && (
        <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />}>
          <BranchSalesOverview />
          <DailyFinancialSummary branchId={effectiveBranchId} />
        </Suspense>
      )}
    </div>
  )
}
