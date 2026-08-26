import { useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { formatCLP, formatDateTime } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useAuthStore } from '@/stores/authStore'
import { useCustomers } from '@/features/customers/useCustomers'
import { useCreditSales, type CreditSaleRow, type CreditPayment } from './useCreditSales'
import type { PaymentMethod } from '@/types/database'

const methodLabels: Record<PaymentMethod, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

export function CreditsPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const [branchId, setBranchId] = useState(activeBranchId)
  const [onlyPending, setOnlyPending] = useState(true)
  const [search, setSearch] = useState('')

  const { rows, pending, totalOutstanding, loading, error, loadPayments, recordPayment, updateDueDate } = useCreditSales(branchId)
  const today = new Date().toISOString().slice(0, 10)
  const { customers } = useCustomers()
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])

  const [detail, setDetail] = useState<CreditSaleRow | null>(null)
  const [payments, setPayments] = useState<CreditPayment[]>([])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [notes, setNotes] = useState('')
  const [dueDateEdit, setDueDateEdit] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const displayRows = useMemo(() => {
    const source = onlyPending ? pending : rows
    const term = search.trim().toLowerCase()
    if (!term) return source
    return source.filter((r) => (r.customerId ? (customerNameById.get(r.customerId) ?? '').toLowerCase().includes(term) : false))
  }, [onlyPending, pending, rows, search, customerNameById])

  // Aging: how much of the outstanding balance is current vs. how many days
  // overdue, bucketed the way a receivables aging report normally is.
  const aging = useMemo(() => {
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }
    for (const r of pending) {
      if (!r.dueDate || r.dueDate >= today) {
        buckets.current += r.remaining
        continue
      }
      const days = Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86400000)
      if (days <= 30) buckets.d1_30 += r.remaining
      else if (days <= 60) buckets.d31_60 += r.remaining
      else if (days <= 90) buckets.d61_90 += r.remaining
      else buckets.d90plus += r.remaining
    }
    return buckets
  }, [pending, today])

  async function openDetail(row: CreditSaleRow) {
    setDetail(row)
    setAmount(String(row.remaining))
    setMethod('efectivo')
    setNotes('')
    setDueDateEdit(row.dueDate ?? '')
    setFormError(null)
    const { payments } = await loadPayments(row.saleId)
    setPayments(payments)
  }

  async function handleSaveDueDate() {
    if (!detail) return
    setSaving(true)
    const result = await updateDueDate(detail.saleId, dueDateEdit || null)
    setSaving(false)
    if (result.error) {
      setFormError(result.error)
      return
    }
    setDetail({ ...detail, dueDate: dueDateEdit || null })
  }

  async function handleRecordPayment() {
    if (!detail) return
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      setFormError('Ingresa un monto válido')
      return
    }
    if (amt > detail.remaining) {
      setFormError(`El monto no puede superar el saldo pendiente (${formatCLP(detail.remaining)})`)
      return
    }
    setSaving(true)
    const result = await recordPayment(detail.saleId, amt, method, notes.trim())
    setSaving(false)
    if (result.error) {
      setFormError(result.error)
      return
    }
    const { payments } = await loadPayments(detail.saleId)
    setPayments(payments)
    const updatedRemaining = detail.remaining - amt
    setDetail({ ...detail, paidAmount: detail.paidAmount + amt, remaining: updatedRemaining })
    setAmount(String(updatedRemaining))
    setNotes('')
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Créditos</h1>
      <p className="mt-1 text-sm text-slate-500">Ventas a crédito y sus pagos pendientes.</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
          {profile?.role === 'admin' && <option value="">Todas las sucursales</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Solo pendientes
        </label>
        <div className="ml-auto rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
          <span className="text-amber-700">Total pendiente: </span>
          <span className="font-semibold text-amber-900">{formatCLP(totalOutstanding)}</span>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs uppercase text-slate-400">Al día</p>
          <p className="mt-1 text-base font-semibold text-slate-900">{formatCLP(aging.current)}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs uppercase text-amber-600">1-30 días</p>
          <p className="mt-1 text-base font-semibold text-amber-800">{formatCLP(aging.d1_30)}</p>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <p className="text-xs uppercase text-orange-600">31-60 días</p>
          <p className="mt-1 text-base font-semibold text-orange-800">{formatCLP(aging.d31_60)}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs uppercase text-red-600">61-90 días</p>
          <p className="mt-1 text-base font-semibold text-red-800">{formatCLP(aging.d61_90)}</p>
        </div>
        <div className="rounded-lg border border-red-300 bg-red-100 p-3">
          <p className="text-xs uppercase text-red-700">+90 días</p>
          <p className="mt-1 text-base font-semibold text-red-900">{formatCLP(aging.d90plus)}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Folio</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Crédito</th>
              <th className="px-4 py-3">Pagado</th>
              <th className="px-4 py-3">Saldo</th>
              <th className="px-4 py-3">Vencimiento</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && displayRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Sin ventas a crédito.
                </td>
              </tr>
            )}
            {displayRows.map((row) => (
              <tr key={row.saleId}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.saleNumber}</td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-3 text-slate-600">{row.customerId ? customerNameById.get(row.customerId) ?? '—' : '—'}</td>
                <td className="px-4 py-3">{formatCLP(row.creditAmount)}</td>
                <td className="px-4 py-3 text-green-700">{formatCLP(row.paidAmount)}</td>
                <td className={`px-4 py-3 font-medium ${row.remaining > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                  {formatCLP(row.remaining)}
                </td>
                <td className="px-4 py-3">
                  {row.dueDate ? (
                    <span
                      className={
                        row.dueDate < today && row.remaining > 0
                          ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
                          : 'text-slate-500'
                      }
                    >
                      {row.dueDate}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openDetail(row)} className="text-slate-400 hover:text-slate-700">
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Crédito venta ${detail?.saleNumber ?? ''}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-400">Crédito</p>
              <p className="font-medium text-slate-900">{formatCLP(detail?.creditAmount ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Pagado</p>
              <p className="font-medium text-green-700">{formatCLP(detail?.paidAmount ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Saldo</p>
              <p className="font-medium text-red-600">{formatCLP(detail?.remaining ?? 0)}</p>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <Input
              label="Fecha de vencimiento"
              type="date"
              value={dueDateEdit}
              onChange={(e) => setDueDateEdit(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="secondary" onClick={handleSaveDueDate} disabled={saving}>
              Guardar
            </Button>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Historial de pagos</p>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-400">Sin pagos registrados todavía.</p>
            ) : (
              <div className="space-y-1">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm text-slate-600">
                    <span>
                      {formatDateTime(p.created_at)} · {methodLabels[p.payment_method]}
                      {p.notes && ` · ${p.notes}`}
                    </span>
                    <span className="font-medium text-slate-900">{formatCLP(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {detail && detail.remaining > 0 && (
            <div className="space-y-3 border-t border-slate-200 pt-3">
              <p className="text-sm font-medium text-slate-700">Registrar pago</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Monto" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Select label="Método" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </Select>
              </div>
              <Input label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <Button onClick={handleRecordPayment} disabled={saving}>
                {saving ? 'Guardando...' : 'Registrar pago'}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
