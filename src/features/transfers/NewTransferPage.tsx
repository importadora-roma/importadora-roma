import { useState } from 'react'
import { Trash2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Input'
import { formatKilo } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useSaleCatalog, type CatalogEntry } from '@/features/sales/useSaleCatalog'
import { ProductSearch } from '@/features/sales/ProductSearch'
import { useTransfers } from './useTransfers'

interface TransferCartItem {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  quantity: number
  availableStock: number
}

export function NewTransferPage() {
  const { branchId: effectiveOrigin, branches } = useEffectiveBranch()
  const [destinationBranchId, setDestinationBranchId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<TransferCartItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { catalog } = useSaleCatalog(effectiveOrigin)
  const { createTransfer } = useTransfers()

  function addItem(entry: CatalogEntry) {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === entry.variantId)
      if (existing) {
        return prev.map((i) => (i.variantId === entry.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, quantity: 1, availableStock: entry.stock },
      ]
    })
  }

  function updateQuantity(variantId: string, quantity: number) {
    setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, quantity) } : i)))
  }

  function removeItem(variantId: string) {
    setItems((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  async function handleSubmit() {
    setError(null)
    if (!destinationBranchId) {
      setError('Selecciona la sucursal destino')
      return
    }
    if (destinationBranchId === effectiveOrigin) {
      setError('La sucursal destino debe ser distinta a la de origen')
      return
    }
    if (items.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    setSubmitting(true)
    const result = await createTransfer(
      effectiveOrigin,
      destinationBranchId,
      items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
      notes.trim() || null
    )
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSuccessMessage('Traslado creado correctamente. El stock de origen ya fue descontado.')
    setItems([])
    setDestinationBranchId('')
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="block text-sm font-medium text-slate-700">Sucursal origen</p>
          <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {branches.find((b) => b.id === effectiveOrigin)?.name}
          </p>
        </div>
        <Select label="Sucursal destino" value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)}>
          <option value="">Selecciona...</option>
          {branches.filter((b) => b.id !== effectiveOrigin).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        <ProductSearch catalog={catalog} onSelect={addItem} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Cantidad</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  Busca productos para agregarlos al traslado.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.variantId}>
                <td className="px-4 py-2">
                  <span className="font-medium text-slate-900">{item.productName}</span>
                  <span className="text-slate-500"> — {item.calidad} {formatKilo(item.kilo)}</span>
                  <div className={`text-xs ${item.quantity > item.availableStock ? 'text-red-600' : 'text-slate-400'}`}>
                    stock disponible: {item.availableStock}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.variantId, Number(e.target.value))}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeItem(item.variantId)} className="text-slate-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 max-w-md">
        <Textarea label="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <Button className="mt-4" onClick={handleSubmit} disabled={submitting || items.length === 0}>
        {submitting ? 'Enviando...' : 'Confirmar traslado'}
      </Button>
    </div>
  )
}
