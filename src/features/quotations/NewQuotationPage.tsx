import { useState } from 'react'
import { Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { formatCLP, formatKilo } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useSaleCatalog, type CatalogEntry } from '@/features/sales/useSaleCatalog'
import { ProductSearch } from '@/features/sales/ProductSearch'
import { CustomerSelect } from '@/features/sales/CustomerSelect'
import { useQuotations } from './useQuotations'

interface QuoteCartItem {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  unitPrice: string
  quantity: number
}

export function NewQuotationPage() {
  const { branchId: effectiveBranchId } = useEffectiveBranch()

  const { catalog } = useSaleCatalog(effectiveBranchId)
  const { createQuotation } = useQuotations(effectiveBranchId)

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<QuoteCartItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const total = items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * i.quantity, 0)

  function addItem(entry: CatalogEntry) {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === entry.variantId)
      if (existing) return prev.map((i) => (i.variantId === entry.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      return [
        ...prev,
        { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, unitPrice: String(entry.price), quantity: 1 },
      ]
    })
  }

  function updateQuantity(variantId: string, quantity: number) {
    setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, quantity) } : i)))
  }

  function updatePrice(variantId: string, unitPrice: string) {
    setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, unitPrice } : i)))
  }

  function removeItem(variantId: string) {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  async function handleSubmit() {
    setError(null)
    if (items.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    setSubmitting(true)
    const result = await createQuotation({
      branch_id: effectiveBranchId,
      customer_id: customerId,
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, unit_price: Number(i.unitPrice) })),
    })
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSuccessMessage('Cotización creada correctamente.')
    setItems([])
    setCustomerId(null)
    setValidUntil('')
    setNotes('')
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
          <ProductSearch catalog={catalog} onSelect={addItem} />

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Producto</th>
                  <th className="px-4 py-2">Cant.</th>
                  <th className="px-4 py-2">Precio</th>
                  <th className="px-4 py-2">Subtotal</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      Busca un producto para agregarlo a la cotización.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.variantId}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-900">{item.productName}</span>
                      <span className="text-slate-500"> — {item.calidad} {formatKilo(item.kilo)}</span>
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
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updatePrice(item.variantId, e.target.value)}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">{formatCLP((Number(item.unitPrice) || 0) * item.quantity)}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => removeItem(item.variantId)} className="text-slate-400 hover:text-red-600">
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
          <Input label="Válida hasta (opcional)" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatCLP(total)}</span>
          </div>
          <Textarea label="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting || items.length === 0}>
            {submitting ? 'Guardando...' : 'Crear cotización'}
          </Button>
        </div>
      </div>
    </div>
  )
}
