import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProfitReport } from './useProfitReport'
import { useExpenses } from '@/features/expenses/useExpenses'
import type { ExpenseCategory } from '@/types/database'

function startOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const categoryLabels: Record<ExpenseCategory, string> = {
  sueldo: 'Sueldo',
  arriendo: 'Arriendo',
  servicios: 'Servicios',
  otro: 'Otro',
}

export function RentabilidadPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const [branchId, setBranchId] = useState(activeBranchId)
  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(today())

  const { revenue, cogs, grossMargin, loading: loadingMargin } = useProfitReport(branchId, from, to)
  const { expenses, total: totalExpenses, loading: loadingExpenses, createExpense, deleteExpense } = useExpenses(branchId, from, to)

  const netProfit = grossMargin - totalExpenses

  const [addOpen, setAddOpen] = useState(false)
  const [category, setCategory] = useState<ExpenseCategory>('sueldo')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  function resetForm() {
    setCategory('sueldo')
    setDescription('')
    setAmount('')
    setExpenseDate(today())
    setNotes('')
    setFormError(null)
  }

  async function handleAddExpense() {
    setFormError(null)
    if (!description.trim()) {
      setFormError('Ingresa una descripción')
      return
    }
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      setFormError('Ingresa un monto válido')
      return
    }
    setSaving(true)
    const { error } = await createExpense({
      category,
      description: description.trim(),
      amount: amt,
      expense_date: expenseDate,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setAddOpen(false)
    resetForm()
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Rentabilidad</h1>
      <p className="mt-1 text-sm text-slate-500">Margen bruto de ventas, menos gastos y sueldos, para ver la utilidad neta real.</p>

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
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Ingresos</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{loadingMargin ? '—' : formatCLP(revenue)}</p>
        </div>
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

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Gastos y sueldos del período</p>
          <Button
            variant="secondary"
            onClick={() => {
              resetForm()
              setAddOpen(true)
            }}
            disabled={!branchId}
          >
            <Plus size={14} /> Agregar gasto
          </Button>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">Descripción</th>
                <th className="px-4 py-2">Monto</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Sin gastos registrados en este período.
                  </td>
                </tr>
              )}
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-slate-500">{formatDate(`${e.expense_date}T00:00:00`)}</td>
                  <td className="px-4 py-2 text-slate-600">{categoryLabels[e.category]}</td>
                  <td className="px-4 py-2 text-slate-900">
                    {e.description}
                    {e.notes && <span className="text-slate-400"> — {e.notes}</span>}
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-900">{formatCLP(e.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setDeleteTarget(e.id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Agregar gasto">
        <div className="space-y-4">
          <Select label="Categoría" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            <option value="sueldo">Sueldo</option>
            <option value="arriendo">Arriendo</option>
            <option value="servicios">Servicios</option>
            <option value="otro">Otro</option>
          </Select>
          <Input
            label="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: sueldo Juan Pérez, arriendo agosto..."
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Monto" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input label="Fecha" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
          <Textarea label="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddExpense} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar gasto"
        confirmLabel="Eliminar"
        onConfirm={(reason) => deleteExpense(deleteTarget!, reason)}
      />
    </div>
  )
}
