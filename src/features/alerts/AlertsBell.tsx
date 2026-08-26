import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, AlertTriangle, Clock, Receipt } from 'lucide-react'
import { formatCLP } from '@/lib/format'
import { useAlerts } from './useAlerts'

export function AlertsBell({ branchId, includeFinancial }: { branchId: string; includeFinancial: boolean }) {
  const [open, setOpen] = useState(false)
  const { lowStock, overdueCredit, pendingInvoices, totalCount } = useAlerts(branchId, includeFinancial)

  function close() {
    setOpen(false)
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
          <button aria-label="Cerrar alertas" onClick={close} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Alertas</p>
            </div>

            {totalCount === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Todo al día.</p>}

            {overdueCredit.length > 0 && (
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-red-600">
                  <Clock size={13} />
                  Créditos vencidos ({overdueCredit.length})
                </div>
                <div className="space-y-1.5">
                  {overdueCredit.slice(0, 6).map((a) => (
                    <Link key={a.saleId} to="/creditos" onClick={close} className="block text-xs text-slate-600 hover:text-slate-900">
                      <span className="font-medium text-slate-900">{a.saleNumber}</span> — {formatCLP(a.remaining)} · {a.daysOverdue}d
                      vencido
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {lowStock.length > 0 && (
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-amber-600">
                  <AlertTriangle size={13} />
                  Stock bajo ({lowStock.length})
                </div>
                <div className="space-y-1.5">
                  {lowStock.slice(0, 6).map((a) => (
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

            {pendingInvoices.length > 0 && (
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-violet-600">
                  <Receipt size={13} />
                  Facturas pendientes ({pendingInvoices.length})
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
