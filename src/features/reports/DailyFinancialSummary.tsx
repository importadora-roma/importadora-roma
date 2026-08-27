import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { formatCLP } from '@/lib/format'
import { useProfitReport } from './useProfitReport'
import { useExpenses } from '@/features/expenses/useExpenses'
import { useTransferValue } from '@/features/transfers/useTransferValue'
import type { ExpenseCategory } from '@/types/database'

const categoryLabels: Record<ExpenseCategory, string> = {
  sueldo: 'Sueldo',
  arriendo: 'Arriendo',
  servicios: 'Servicios',
  otro: 'Otro',
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DailyFinancialSummary({ branchId }: { branchId: string }) {
  const day = today()
  const { cogs, grossMargin, loading: loadingMargin } = useProfitReport(branchId, day, day)
  const { expenses, total: totalExpenses, loading: loadingExpenses, createExpense } = useExpenses(branchId, day, day)
  const { total: transferValue, transferCount, loading: loadingTransfers } = useTransferValue(branchId, day, day)

  const netProfit = grossMargin - totalExpenses

  const expensesByCategory = useMemo(() => {
    const totals: Record<ExpenseCategory, number> = { sueldo: 0, arriendo: 0, servicios: 0, otro: 0 }
    for (const e of expenses) totals[e.category] += e.amount
    return totals
  }, [expenses])

  const [addOpen, setAddOpen] = useState(false)
  const [category, setCategory] = useState<ExpenseCategory>('otro')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setCategory('otro')
    setDescription('')
    setAmount('')
    setNotes('')
    setFormError(null)
    setAddOpen(true)
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
      expense_date: day,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setAddOpen(false)
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Resumen financiero de hoy</p>
        <Button variant="secondary" onClick={openAdd} disabled={!branchId}>
          <Plus size={14} />
          Agregar gasto
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase text-slate-500">Costo (COGS)</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loadingMargin ? '—' : formatCLP(cogs)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Margen bruto</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loadingMargin ? '—' : formatCLP(grossMargin)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Gastos</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loadingExpenses ? '—' : formatCLP(totalExpenses)}</p>
        </div>
        <div>
          <p className={`text-xs uppercase ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>Utilidad neta</p>
          <p className={`mt-1 text-lg font-semibold ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
            {loadingMargin || loadingExpenses ? '—' : formatCLP(netProfit)}
          </p>
        </div>
      </div>

      {!loadingExpenses && totalExpenses > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {(Object.keys(categoryLabels) as ExpenseCategory[])
            .filter((c) => expensesByCategory[c] > 0)
            .map((c) => (
              <span key={c} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {categoryLabels[c]}: <span className="font-medium text-slate-900">{formatCLP(expensesByCategory[c])}</span>
              </span>
            ))}
        </div>
      )}

      {!loadingTransfers && transferValue > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Traslados enviados a otras sucursales hoy: <span className="font-medium text-slate-700">{formatCLP(transferValue)}</span> (
          {transferCount} traslado{transferCount === 1 ? '' : 's'}, no cuenta como venta)
        </p>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Agregar gasto de hoy">
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
            placeholder="Ej: compra de insumos, flete, colación..."
          />
          <Input label="Monto" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
    </div>
  )
}
