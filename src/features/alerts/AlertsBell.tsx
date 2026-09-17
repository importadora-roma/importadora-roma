import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Bell, AlertTriangle, Clock, Receipt, Trash2 } from 'lucide-react'
import { formatCLP } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'
import { useAlerts } from './useAlerts'

// Alerts are computed live from real business data (stock levels, overdue
// credit, pending invoices) — there's no stored "notification" row to mark
// read. "Clear" instead remembers the keys of whatever is on screen right
// now (per browser, per user) and hides just those; if the same alert comes
// back (e.g. stock drops again after a restock) it reappears as new.
function dismissedKey(userId: string) {
  return `alerts_dismissed_${userId}`
}

function loadDismissed(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(userId))
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function AlertsBell({ branchId, includeFinancial }: { branchId: string; includeFinancial: boolean }) {
  const [open, setOpen] = useState(false)
  const userId = useAuthStore((s) => s.profile?.id)
  const { lowStock, overdueCredit, pendingInvoices } = useAlerts(branchId, includeFinancial)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (userId) setDismissed(loadDismissed(userId))
  }, [userId])

  const visibleLowStock = lowStock.filter((a) => !dismissed.has(`stock:${a.variantId}`))
  const visibleOverdueCredit = overdueCredit.filter((a) => !dismissed.has(`credit:${a.saleId}`))
  const visiblePendingInvoices = pendingInvoices.filter((i) => !dismissed.has(`invoice:${i.invoice_id}`))
  const totalCount = visibleLowStock.length + visibleOverdueCredit.length + visiblePendingInvoices.length

  function close() {
    setOpen(false)
  }

  function clearAll() {
    if (!userId) return
    const next = new Set(dismissed)
    for (const a of lowStock) next.add(`stock:${a.variantId}`)
    for (const a of overdueCredit) next.add(`credit:${a.saleId}`)
    for (const i of pendingInvoices) next.add(`invoice:${i.invoice_id}`)
    setDismissed(next)
    try {
      localStorage.setItem(dismissedKey(userId), JSON.stringify([...next]))
    } catch {
      // best-effort — worst case the clear doesn't persist across reloads
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
        aria-label="Alertas"
      >
        <Bell size={19} />
        {totalCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Portaled: this bell sits inside the topbar's backdrop-blur,
              which — like any filter/backdrop-filter — becomes the
              containing block for `fixed` descendants, shrinking this
              full-screen click-outside catcher down to the topbar's own
              height. Escaping to document.body keeps it viewport-sized. */}
          {createPortal(
            <button aria-label="Cerrar alertas" onClick={close} className="fixed inset-0 z-40 cursor-default" />,
            document.body
          )}
          <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Alertas</p>
              {totalCount > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
                  title="Limpiar alertas actuales"
                >
                  <Trash2 size={13} />
                  Limpiar
                </button>
              )}
            </div>

            {totalCount === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Todo al día.</p>}

            {visibleOverdueCredit.length > 0 && (
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-red-600">
                  <Clock size={13} />
                  Créditos vencidos ({visibleOverdueCredit.length})
                </div>
                <div className="space-y-1.5">
                  {visibleOverdueCredit.slice(0, 6).map((a) => (
                    <Link key={a.saleId} to="/creditos" onClick={close} className="block text-xs text-slate-600 hover:text-slate-900">
                      <span className="font-medium text-slate-900">{a.saleNumber}</span> — {formatCLP(a.remaining)} · {a.daysOverdue}d
                      vencido
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {visibleLowStock.length > 0 && (
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-amber-600">
                  <AlertTriangle size={13} />
                  Stock bajo ({visibleLowStock.length})
                </div>
                <div className="space-y-1.5">
                  {visibleLowStock.slice(0, 6).map((a) => (
                    <Link
                      key={a.variantId}
                      to="/inventario"
                      onClick={close}
                      className="block text-xs text-slate-600 hover:text-slate-900"
                    >
                      <span className="font-medium text-slate-900">{a.productName}</span> {a.calidad} — {a.quantity} u.
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {visiblePendingInvoices.length > 0 && (
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-violet-600">
                  <Receipt size={13} />
                  Facturas pendientes ({visiblePendingInvoices.length})
                </div>
                <Link to="/facturas" onClick={close} className="text-xs text-slate-600 hover:text-slate-900">
                  Ver facturas pendientes →
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
