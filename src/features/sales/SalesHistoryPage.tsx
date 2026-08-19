import { useMemo, useState } from 'react'
import { Eye, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select, Input } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatDateTime, formatKilo } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useCustomers } from '@/features/customers/useCustomers'
import { useSales, type Sale, type SaleItem, type SalePayment } from './useSales'
import { useSaleCatalog, type CatalogEntry } from './useSaleCatalog'
import { ProductSearch } from './ProductSearch'
import { generateSalePdf } from './salePdf'
import type { PaymentMethod } from '@/types/database'

const statusLabels: Record<string, string> = { completed: 'Completada', cancelled: 'Anulada' }
const paymentLabels: Record<PaymentMethod, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

export function SalesHistoryPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const { products, variants } = useProducts()
  const { customers } = useCustomers()
  const [branchId, setBranchId] = useState(activeBranchId)

  const { sales, loading, error, loadSaleDetail, cancelSale, exchangeSaleItem } = useSales(branchId)

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])
  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  function variantLabel(variantId: string): string {
    const variant = variantById.get(variantId)
    if (!variant) return '—'
    const productName = productNameById.get(variant.product_id) ?? '—'
    return `${productName} — ${variant.calidad} ${formatKilo(variant.kilo)}`
  }

  const [detailSale, setDetailSale] = useState<Sale | null>(null)
  const [detailItems, setDetailItems] = useState<SaleItem[]>([])
  const [detailPayments, setDetailPayments] = useState<SalePayment[]>([])
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null)
  const [exchangeTarget, setExchangeTarget] = useState<SaleItem | null>(null)

  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'

  async function openDetail(sale: Sale) {
    setDetailSale(sale)
    const { items, payments } = await loadSaleDetail(sale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  async function refreshDetail() {
    if (!detailSale) return
    const { items, payments } = await loadSaleDetail(detailSale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  return (
    <div>
      <div className="mb-4">
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
          {profile?.role === 'admin' && <option value="">Todas las sucursales</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Folio</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && sales.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Sin ventas todavía.
                </td>
              </tr>
            )}
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{sale.sale_number}</td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(sale.created_at)}</td>
                <td className="px-4 py-3 text-slate-600">{sale.customer_id ? customerNameById.get(sale.customer_id) ?? '—' : '—'}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{formatCLP(sale.total)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      sale.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {statusLabels[sale.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openDetail(sale)} className="text-slate-400 hover:text-slate-700">
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!detailSale} onClose={() => setDetailSale(null)} title={`Venta ${detailSale?.sale_number ?? ''}`}>
        <div className="space-y-4">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1 pr-2">Cant.</th>
                <th className="py-1 pr-2">Precio</th>
                <th className="py-1 pr-2">Estado</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detailItems.map((item) => {
                const variant = variantById.get(item.variant_id)
                const productName = variant ? productNameById.get(variant.product_id) ?? '—' : '—'
                return (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-2">
                      {productName} {variant && `— ${variant.calidad} ${formatKilo(variant.kilo)}`}
                    </td>
                    <td className="py-1.5 pr-2">{item.quantity}</td>
                    <td className="py-1.5 pr-2">{formatCLP(item.sold_price)}</td>
                    <td className="py-1.5 pr-2 text-xs text-slate-500">{item.status}</td>
                    <td className="py-1.5">
                      {canManage && item.status === 'active' && detailSale?.status === 'completed' && (
                        <button onClick={() => setExchangeTarget(item)} className="text-xs text-slate-500 underline hover:text-slate-800">
                          Cambiar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="border-t border-slate-200 pt-2 text-sm">
            <p className="font-medium text-slate-700">Pagos</p>
            {detailPayments.map((p) => (
              <div key={p.id} className="flex justify-between text-slate-600">
                <span>{paymentLabels[p.payment_method]}</span>
                <span>{formatCLP(p.amount)}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                detailSale &&
                generateSalePdf(detailSale, detailItems, detailPayments, {
                  branchName: branchNameById.get(detailSale.branch_id) ?? '',
                  customerName: detailSale.customer_id ? customerNameById.get(detailSale.customer_id) ?? null : null,
                  variantLabel,
                })
              }
            >
              <Printer size={16} />
              Imprimir
            </Button>
            {detailSale?.status === 'completed' && canManage && (
              <Button variant="danger" onClick={() => setCancelTarget(detailSale)}>
                Anular venta
              </Button>
            )}
          </div>
          {detailSale?.status === 'cancelled' && detailSale.cancel_reason && (
            <p className="text-sm text-red-600">Motivo de anulación: {detailSale.cancel_reason}</p>
          )}
        </div>
      </Modal>

      <ReasonModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={`Anular venta ${cancelTarget?.sale_number ?? ''}`}
        confirmLabel="Anular"
        onConfirm={async (reason) => {
          const result = await cancelSale(cancelTarget!.id, reason)
          if (!result.error) {
            setDetailSale(null)
          }
          return result
        }}
      />

      {exchangeTarget && detailSale && (
        <ExchangeModal
          item={exchangeTarget}
          branchId={detailSale.branch_id}
          onClose={() => setExchangeTarget(null)}
          onConfirm={async (newVariantId, newQuantity, reason, additionalPayments) => {
            const result = await exchangeSaleItem(exchangeTarget.id, newVariantId, newQuantity, reason, additionalPayments)
            if (!result.error) {
              setExchangeTarget(null)
              await refreshDetail()
            }
            return result
          }}
        />
      )}
    </div>
  )
}

function ExchangeModal({
  item,
  branchId,
  onClose,
  onConfirm,
}: {
  item: SaleItem
  branchId: string
  onClose: () => void
  onConfirm: (
    newVariantId: string,
    newQuantity: number,
    reason: string,
    additionalPayments: { payment_method: PaymentMethod; amount: number }[]
  ) => Promise<{ error: string | null }>
}) {
  const { catalog } = useSaleCatalog(branchId)
  const [selected, setSelected] = useState<CatalogEntry | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('efectivo')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const newTotal = selected ? selected.price * (Number(quantity) || 0) : 0
  const difference = newTotal - item.line_total

  async function handleConfirm() {
    if (!selected) {
      setError('Selecciona el producto de reemplazo')
      return
    }
    const qty = Number(quantity)
    if (!qty || qty <= 0) {
      setError('Cantidad inválida')
      return
    }
    if (!reason.trim()) {
      setError('Indica un motivo')
      return
    }
    if (difference < 0) {
      setError('El producto de reemplazo no puede ser de menor valor')
      return
    }
    setSaving(true)
    const result = await onConfirm(
      selected.variantId,
      qty,
      reason.trim(),
      difference > 0 ? [{ payment_method: paymentMethod, amount: difference }] : []
    )
    setSaving(false)
    if (result.error) setError(result.error)
  }

  return (
    <Modal open onClose={onClose} title="Cambiar producto">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Valor original: {formatCLP(item.line_total)}</p>
        <ProductSearch catalog={catalog} onSelect={setSelected} />
        {selected && (
          <p className="text-sm text-slate-700">
            Seleccionado: {selected.productName} — {selected.calidad} {formatKilo(selected.kilo)} ({formatCLP(selected.price)})
          </p>
        )}
        <Input label="Cantidad" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />

        {selected && (
          <p className={`text-sm font-medium ${difference > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
            Diferencia a cobrar: {formatCLP(Math.max(difference, 0))}
          </p>
        )}

        {difference > 0 && (
          <Select label="Método de pago de la diferencia" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="transferencia">Transferencia</option>
          </Select>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? 'Procesando...' : 'Confirmar cambio'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
