import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatCLP } from '@/lib/format'
import type { SalePaymentMethod } from '@/types/database'

export interface PaymentLine {
  method: SalePaymentMethod
  amount: string
}

const methodLabels: Record<SalePaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
}

export function PaymentSplit({
  payments,
  total,
  onChange,
  allowCredit = false,
}: {
  payments: PaymentLine[]
  total: number
  onChange: (payments: PaymentLine[]) => void
  allowCredit?: boolean
}) {
  const paidSoFar = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const remaining = total - paidSoFar
  const availableMethods = allowCredit
    ? (Object.keys(methodLabels) as SalePaymentMethod[])
    : (Object.keys(methodLabels) as SalePaymentMethod[]).filter((m) => m !== 'credito')

  function updateLine(index: number, patch: Partial<PaymentLine>) {
    onChange(payments.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function addLine() {
    onChange([...payments, { method: 'efectivo', amount: remaining > 0 ? String(remaining) : '' }])
  }

  function removeLine(index: number) {
    onChange(payments.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {payments.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={p.method}
            onChange={(e) => updateLine(i, { method: e.target.value as SalePaymentMethod })}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
          >
            {availableMethods.map((value) => (
              <option key={value} value={value}>
                {methodLabels[value]}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={p.amount}
            onChange={(e) => updateLine(i, { amount: e.target.value })}
            placeholder="Monto"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button onClick={() => removeLine(i)} className="text-slate-400 hover:text-red-600">
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <Button variant="secondary" onClick={addLine} type="button">
        <Plus size={14} />
        Agregar pago
      </Button>

      {payments.some((p) => p.method === 'credito') && (
        <p className="text-xs text-amber-600">El monto en Crédito queda pendiente de cobro — requiere un cliente seleccionado.</p>
      )}

      <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
        <span className="text-slate-500">Restante</span>
        <span className={remaining === 0 ? 'font-medium text-green-700' : 'font-medium text-amber-600'}>{formatCLP(remaining)}</span>
      </div>
    </div>
  )
}
