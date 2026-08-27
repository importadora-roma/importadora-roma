import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { formatCLP, formatDate } from '@/lib/format'
import { createPdfDoc, autoTable } from '@/lib/pdf'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useReports } from './useReports'
import { useProfitReport } from './useProfitReport'
import { useExpenses } from '@/features/expenses/useExpenses'
import { useTransferValue } from '@/features/transfers/useTransferValue'
import type { PaymentMethod, ExpenseCategory } from '@/types/database'

const categoryLabels: Record<ExpenseCategory, string> = {
  sueldo: 'Sueldo',
  arriendo: 'Arriendo',
  servicios: 'Servicios',
  otro: 'Otro',
}

function startOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ReportsPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const [branchId, setBranchId] = useState(activeBranchId)
  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(today())

  const { sales, payments, loading, error } = useReports(branchId, from, to)
  const { cogs, grossMargin, loading: loadingMargin } = useProfitReport(branchId, from, to)
  const { expenses, total: totalExpenses, loading: loadingExpenses } = useExpenses(branchId, from, to)
  const { total: transferValue, transferCount, loading: loadingTransfers } = useTransferValue(branchId, from, to)

  const totalsByMethod = useMemo(() => {
    const totals: Record<PaymentMethod, number> = { efectivo: 0, tarjeta: 0, transferencia: 0 }
    for (const p of payments) totals[p.payment_method] += p.amount
    return totals
  }, [payments])

  const expensesByCategory = useMemo(() => {
    const totals: Record<ExpenseCategory, number> = { sueldo: 0, arriendo: 0, servicios: 0, otro: 0 }
    for (const e of expenses) totals[e.category] += e.amount
    return totals
  }, [expenses])

  const grandTotal = sales.reduce((s, sale) => s + sale.total, 0)
  const netProfit = grossMargin - totalExpenses

  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of sales) {
      const day = sale.created_at.slice(0, 10)
      map.set(day, (map.get(day) ?? 0) + sale.total)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date: formatDate(`${date}T00:00:00`), total }))
  }, [sales])

  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name ?? '' : 'Todas las sucursales'

  function exportPdf() {
    const doc = createPdfDoc('Reporte de ventas', `${branchName} · ${formatDate(`${from}T00:00:00`)} - ${formatDate(`${to}T00:00:00`)}`)
    autoTable(doc, {
      startY: 38,
      head: [['Métrica', 'Monto']],
      body: [
        ['Total ventas', formatCLP(grandTotal)],
        ['Cantidad de ventas', String(sales.length)],
        ['Efectivo', formatCLP(totalsByMethod.efectivo)],
        ['Tarjeta', formatCLP(totalsByMethod.tarjeta)],
        ['Transferencia', formatCLP(totalsByMethod.transferencia)],
        ['Costo (COGS)', formatCLP(cogs)],
        ['Margen bruto', formatCLP(grossMargin)],
        ['Gastos', formatCLP(totalExpenses)],
        ['Utilidad neta', formatCLP(netProfit)],
        ['Traslados enviados a otras sucursales (valor)', formatCLP(transferValue)],
      ],
    })
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
      head: [['Gasto por categoría', 'Monto']],
      body: (Object.keys(categoryLabels) as ExpenseCategory[]).map((c) => [categoryLabels[c], formatCLP(expensesByCategory[c])]),
    })
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
      head: [['Fecha', 'Total del día']],
      body: dailyTotals.map((d) => [d.date, formatCLP(d.total)]),
    })
    doc.save(`reporte-ventas-${from}-a-${to}.pdf`)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Reportes</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Select label="Sucursal" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
          {profile?.role === 'admin' && <option value="">Todas las sucursales</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Input label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" onClick={exportPdf} disabled={loading || sales.length === 0}>
          <Download size={16} />
          Exportar PDF
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Total ventas</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatCLP(grandTotal)}</p>
          <p className="text-xs text-slate-400">{sales.length} ventas</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Efectivo</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatCLP(totalsByMethod.efectivo)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Tarjeta</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatCLP(totalsByMethod.tarjeta)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Transferencia (pago)</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatCLP(totalsByMethod.transferencia)}</p>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium text-slate-700">Resumen del período</p>
        <p className="mt-1 text-xs text-slate-400">Ventas menos costo y gastos — la utilidad real, no solo lo vendido.</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">Costo (COGS)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{loadingMargin ? '—' : formatCLP(cogs)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">Margen bruto</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{loadingMargin ? '—' : formatCLP(grossMargin)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">Gastos</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{loadingExpenses ? '—' : formatCLP(totalExpenses)}</p>
          </div>
          <div className={`rounded-lg border p-4 ${netProfit >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className={`text-xs uppercase ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>Utilidad neta</p>
            <p className={`mt-1 text-xl font-semibold ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
              {loadingMargin || loadingExpenses ? '—' : formatCLP(netProfit)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase text-slate-500">Traslados a otras sucursales</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">{loadingTransfers ? '—' : formatCLP(transferValue)}</p>
        <p className="text-xs text-slate-400">
          {loadingTransfers
            ? ''
            : `${transferCount} traslado${transferCount === 1 ? '' : 's'} ${transferCount === 1 ? 'enviado' : 'enviados'} — no cuenta como venta`}
        </p>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <p className="px-4 pt-4 text-sm font-medium text-slate-700">Gastos por categoría</p>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loadingExpenses ? (
              <tr>
                <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            ) : totalExpenses === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                  Sin gastos registrados en este período.
                </td>
              </tr>
            ) : (
              (Object.keys(categoryLabels) as ExpenseCategory[])
                .filter((c) => expensesByCategory[c] > 0)
                .map((c) => (
                  <tr key={c}>
                    <td className="px-4 py-2 text-slate-600">{categoryLabels[c]}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{formatCLP(expensesByCategory[c])}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-4 text-sm font-medium text-slate-700">Ventas por día</p>
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando...</p>
        ) : dailyTotals.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Sin ventas en el rango seleccionado.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyTotals}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCLP(v)} width={90} />
              <Tooltip formatter={(v) => formatCLP(Number(v))} />
              <Bar dataKey="total" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
