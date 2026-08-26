import { useEffect, useState } from 'react'
import { Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { formatCLP, formatKilo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useAuthStore } from '@/stores/authStore'
import { useAlertSettings } from '@/features/alerts/useAlertSettings'
import { useSaleCatalog, type CatalogEntry } from './useSaleCatalog'
import { ProductSearch } from './ProductSearch'
import { PaymentSplit, type PaymentLine } from './PaymentSplit'
import { CustomerSelect } from './CustomerSelect'

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

interface CartItem {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  originalPrice: number
  soldPrice: string
  quantity: number
  maxStock: number
  cost: number
}

export function NewSalePage() {
  const profile = useAuthStore((s) => s.profile)
  const canSeeCost = profile?.role === 'admin' || profile?.role === 'supervisor'
  const { branchId: effectiveBranchId, branches } = useEffectiveBranch()

  const { catalog, loading: catalogLoading, reloadInventory } = useSaleCatalog(effectiveBranchId)
  const { settings: alertSettings } = useAlertSettings()
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'efectivo', amount: '' }])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const total = cart.reduce((sum, item) => sum + (Number(item.soldPrice) || 0) * item.quantity, 0)
  const totalMargin = cart.reduce((sum, item) => sum + ((Number(item.soldPrice) || 0) - item.cost) * item.quantity, 0)
  const hasCredit = payments.some((p) => p.method === 'credito')

  useEffect(() => {
    if (hasCredit && !dueDate) setDueDate(addDays(alertSettings.credit_default_term_days))
    if (!hasCredit && dueDate) setDueDate('')
  }, [hasCredit, dueDate, alertSettings.credit_default_term_days])

  function addToCart(entry: CatalogEntry) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === entry.variantId)
      if (existing) {
        return prev.map((i) => (i.variantId === entry.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        {
          variantId: entry.variantId,
          productName: entry.productName,
          calidad: entry.calidad,
          kilo: entry.kilo,
          originalPrice: entry.price,
          soldPrice: String(entry.price),
          quantity: 1,
          maxStock: entry.stock,
          cost: entry.cost,
        },
      ]
    })
  }

  function updateQuantity(variantId: string, quantity: number) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, quantity) } : i)))
  }

  function updatePrice(variantId: string, soldPrice: string) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, soldPrice } : i)))
  }

  function removeFromCart(variantId: string) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  function resetSale() {
    setCart([])
    setCustomerId(null)
    setPayments([{ method: 'efectivo', amount: '' }])
    setDueDate('')
    setNotes('')
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (cart.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    const paymentsPayload = payments
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({ payment_method: p.method, amount: Number(p.amount) }))

    if (paymentsPayload.length === 0) {
      setError('Registra al menos un pago')
      return
    }
    if (paymentsPayload.some((p) => p.payment_method === 'credito') && !customerId) {
      setError('Selecciona un cliente para una venta a crédito')
      return
    }
    const paymentsTotal = paymentsPayload.reduce((s, p) => s + p.amount, 0)
    if (Math.round(paymentsTotal) !== Math.round(total)) {
      setError(`El total de pagos (${formatCLP(paymentsTotal)}) no coincide con el total de la venta (${formatCLP(total)})`)
      return
    }

    setSubmitting(true)
    const { data, error } = await supabase.rpc('create_sale', {
      p_branch_id: effectiveBranchId,
      p_customer_id: customerId,
      p_items: cart.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, sold_price: Number(i.soldPrice) })),
      p_payments: paymentsPayload,
      p_notes: notes.trim() || null,
    })

    if (error) {
      setSubmitting(false)
      setError(error.message)
      return
    }

    if (hasCredit && dueDate) {
      await supabase.from('sales').update({ due_date: dueDate }).eq('id', data)
    }
    setSubmitting(false)

    setSuccessMessage(`Venta registrada correctamente (folio interno ${data}).`)
    resetSale()
    reloadInventory()
  }

  if (branches.length === 0) {
    return <p className="text-sm text-slate-500">Primero crea una sucursal en Configuración.</p>
  }

  return (
    <div>
      {successMessage && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 size={16} />
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProductSearch catalog={catalog} onSelect={addToCart} />

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Producto</th>
                  <th className="px-4 py-2">Cant.</th>
                  <th className="px-4 py-2">Precio original</th>
                  <th className="px-4 py-2">Precio venta</th>
                  <th className="px-4 py-2">Subtotal</th>
                  {canSeeCost && <th className="px-4 py-2">Margen</th>}
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalogLoading && cart.length === 0 && (
                  <tr>
                    <td colSpan={canSeeCost ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                      Cargando catálogo...
                    </td>
                  </tr>
                )}
                {cart.length === 0 && !catalogLoading && (
                  <tr>
                    <td colSpan={canSeeCost ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                      Busca un producto para agregarlo a la venta.
                    </td>
                  </tr>
                )}
                {cart.map((item) => (
                  <tr key={item.variantId}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-900">{item.productName}</span>
                      <span className="text-slate-500"> — {item.calidad} {formatKilo(item.kilo)}</span>
                      <div className={`text-xs ${item.maxStock - item.quantity < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        stock disponible: {item.maxStock}
                        {item.quantity > item.maxStock && ' (quedará negativo)'}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.variantId, Number(e.target.value))}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{formatCLP(item.originalPrice)}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={item.soldPrice}
                        onChange={(e) => updatePrice(item.variantId, e.target.value)}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {formatCLP((Number(item.soldPrice) || 0) * item.quantity)}
                    </td>
                    {canSeeCost && (
                      <td
                        className={`px-4 py-2 ${(Number(item.soldPrice) || 0) - item.cost >= 0 ? 'text-green-700' : 'text-red-600'}`}
                      >
                        {formatCLP(((Number(item.soldPrice) || 0) - item.cost) * item.quantity)}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <button onClick={() => removeFromCart(item.variantId)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <CustomerSelect customerId={customerId} onChange={setCustomerId} />

          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatCLP(total)}</span>
          </div>

          {canSeeCost && cart.length > 0 && (
            <div className={`flex justify-between text-sm ${totalMargin >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              <span>Margen estimado</span>
              <span className="font-medium">{formatCLP(totalMargin)}</span>
            </div>
          )}

          <PaymentSplit payments={payments} total={total} onChange={setPayments} allowCredit />

          {hasCredit && (
            <Input label="Fecha de vencimiento del crédito" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          )}

          <Textarea label="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button className="w-full" onClick={handleSubmit} disabled={submitting || cart.length === 0}>
            {submitting ? 'Procesando...' : 'Confirmar venta'}
          </Button>
        </div>
      </div>
    </div>
  )
}
