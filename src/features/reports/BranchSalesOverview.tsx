import { useMemo, useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatCLP } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useReports } from './useReports'
import type { SalePaymentMethod } from '@/types/database'

const branchColors = ['#0f172a', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#dc2626', '#0891b2', '#db2777']

type Period = 'today' | 'week' | 'month'

function rangeFor(period: Period): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  if (period === 'today') return { from: to, to }
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    return { from: d.toISOString().slice(0, 10), to }
  }
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

const methodColors: Record<SalePaymentMethod, string> = {
  efectivo: '#16a34a',
  tarjeta: '#2563eb',
  transferencia: '#9333ea',
  credito: '#f59e0b',
}

interface BranchRow {
  branchId: string
  branchName: string
  total: number
  count: number
  efectivo: number
  tarjeta: number
  transferencia: number
  credito: number
}

// Real-time (period-scoped) per-branch sales + payment-method breakdown for
// the Panel. Admins see every branch they have access to; supervisors see
// only their own branch (RLS on `sales` already enforces this regardless of
// what branch filter the client sends, so passing '' here is safe for both).
export function BranchSalesOverview() {
  const { branches } = useEffectiveBranch()
  const [period, setPeriod] = useState<Period>('today')
  const { from, to } = rangeFor(period)
  const { sales, payments, loading } = useReports('', from, to)

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const rows = useMemo<BranchRow[]>(() => {
    const totalsByBranch = new Map<string, BranchRow>()
    const branchBySaleId = new Map(sales.map((s) => [s.id, s.branch_id]))

    for (const sale of sales) {
      const row =
        totalsByBranch.get(sale.branch_id) ??
        ({
          branchId: sale.branch_id,
          branchName: branchNameById.get(sale.branch_id) ?? '—',
          total: 0,
          count: 0,
          efectivo: 0,
          tarjeta: 0,
          transferencia: 0,
          credito: 0,
        } satisfies BranchRow)
      row.total += sale.total
      row.count += 1
      totalsByBranch.set(sale.branch_id, row)
    }

    for (const p of payments) {
      const branchId = branchBySaleId.get(p.sale_id)
      if (!branchId) continue
      const row = totalsByBranch.get(branchId)
      if (!row) continue
      const method = p.payment_method as SalePaymentMethod
      if (method in methodColors) row[method] += p.amount
    }

    return Array.from(totalsByBranch.values()).sort((a, b) => b.total - a.total)
  }, [sales, payments, branchNameById])

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const grandCount = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Ventas por sucursal</p>
        <div className="flex gap-1">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                period === p ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'today' ? 'Hoy' : p === 'week' ? 'Últimos 7 días' : 'Este mes'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Cargando...</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">Sin ventas en el período seleccionado.</p>
      ) : (
        <>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="total"
                  nameKey="branchName"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={rows.length > 1 ? 2 : 0}
                >
                  {rows.map((r, i) => (
                    <Cell key={r.branchId} fill={branchColors[i % branchColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCLP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3">Sucursal</th>
                  <th className="py-1.5 pr-3 text-right"># Ventas</th>
                  <th className="py-1.5 pr-3 text-right">Efectivo</th>
                  <th className="py-1.5 pr-3 text-right">Tarjeta</th>
                  <th className="py-1.5 pr-3 text-right">Transferencia</th>
                  <th className="py-1.5 pr-3 text-right">Crédito</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.branchId}>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{r.branchName}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.count}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCLP(r.efectivo)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCLP(r.tarjeta)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCLP(r.transferencia)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCLP(r.credito)}</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{formatCLP(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="py-1.5 pr-3">Total</td>
                  <td className="py-1.5 pr-3 text-right">{grandCount}</td>
                  <td className="py-1.5 pr-3 text-right">{formatCLP(rows.reduce((s, r) => s + r.efectivo, 0))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatCLP(rows.reduce((s, r) => s + r.tarjeta, 0))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatCLP(rows.reduce((s, r) => s + r.transferencia, 0))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatCLP(rows.reduce((s, r) => s + r.credito, 0))}</td>
                  <td className="py-1.5 text-right">{formatCLP(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
