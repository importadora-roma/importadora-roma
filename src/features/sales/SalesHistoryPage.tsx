import { useMemo, useState } from 'react'
import { Eye, Mail, MessageCircle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select, Input } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatDateTime, formatKilo } from '@/lib/format'
import { whatsappUrl, mailtoUrl } from '@/lib/share'
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

  const { sales, loading, error, loadSaleDetail, cancelSale, exchangeSaleItem, returnSaleItem, setRequiresInvoice, updateSaleItemCost } =
    useSales(branchId)

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const branchAddressById = useMemo(() => new Map(branches.map((b) => [b.id, b.address])), [branches])

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
  const [returnTarget, setReturnTarget] = useState<SaleItem | null>(null)
  const [costError, setCostError] = useState<{ itemId: string; message: string } | null>(null)

  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'

  async function openDetail(sale: Sale) {
    setDetailSale(sale)
    const { items, payments } = await loadSaleDetail(sale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  function shareMessage(sale: Sale): string {
    const lines = [
      `Comprobante de venta ${sale.sale_number}`,
      ...detailItems
        .filter((i) => i.status === 'active')
        .map((item) => `- ${item.quantity} x ${variantLabel(item.variant_id)}: ${formatCLP(item.line_total)}`),
      `Total: ${formatCLP(sale.total)}`,
      '¡Gracias por tu compra!',
    ]
    return lines.filter(Boolean).join('\n')
  }

  async function refreshDetail() {
    if (!detailSale) return
    const { items, payments } = await loadSaleDetail(detailSale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  async function handleCostBlur(item: SaleItem, value: string) {
    const raw = Number(value)
    if (Number.isNaN(raw) || raw < 0) return
    const cost = raw > 0 && raw < 1000 ? raw * 1000 : raw
    if (cost === item.cost) return
    const { error } = await updateSaleItemCost(item.id, cost)
    if (error) {
      setCostError({ itemId: item.id, message: error })
      return
    }
    setCostError(null)
    setDetailItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, cost } : i)))
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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
                  {sale.requires_invoice && (
                    <span className="ml-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Factura</span>
                  )}
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
                {canManage && <th className="py-1 pr-2">Costo</th>}
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
                    {canManage && (
                      <td className="py-1.5 pr-2">
                        <input
                          type="number"
                          min={0}
                          defaultValue={item.cost}
                          onBlur={(e) => handleCostBlur(item, e.target.value)}
                          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        {costError?.itemId === item.id && <p className="mt-0.5 text-xs text-red-600">{costError.message}</p>}
                      </td>
                    )}
                    <td className="py-1.5 pr-2 text-xs text-slate-500">{item.status}</td>
                    <td className="py-1.5 space-x-2">
                      {canManage && item.status === 'active' && detailSale?.status === 'completed' && (
                        <>
                          <button onClick={() => setExchangeTarget(item)} className="text-xs text-slate-500 underline hover:text-slate-800">
                            Cambiar
                          </button>
                          <button onClick={() => setReturnTarget(item)} className="text-xs text-slate-500 underline hover:text-slate-800">
                            Devolver
                          </button>
                        </>
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

          {detailSale?.status === 'completed' && (
            <label className="flex items-center gap-2 border-t border-slate-200 pt-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={detailSale.requires_invoice}
                onChange={async (e) => {
                  const requires = e.target.checked
                  const { error } = await setRequiresInvoice(detailSale.id, requires)
                  if (!error) setDetailSale((s) => (s ? { ...s, requires_invoice: requires } : s))
                }}
              />
              Requiere factura (aparecerá en el pool de Facturas)
            </label>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                detailSale &&
                generateSalePdf(detailSale, detailItems, detailPayments, {
                  branchName: branchNameById.get(detailSale.branch_id) ?? '',
                  branchAddress: branchAddressById.get(detailSale.branch_id) ?? null,
                  customerName: detailSale.customer_id ? customerNameById.get(detailSale.customer_id) ?? null : null,
                  variantLabel,
                })
              }
            >
              <Printer size={16} />
              Imprimir
            </Button>
            {detailSale && (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      whatsappUrl(detailSale.customer_id ? customerById.get(detailSale.customer_id)?.phone ?? null : null, shareMessage(detailSale)),
                      '_blank'
                    )
                  }
                >
                  <MessageCircle size={16} />
                  WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      mailtoUrl(
                        detailSale.customer_id ? customerById.get(detailSale.customer_id)?.email ?? null : null,
                        `Comprobante de venta ${detailSale.sale_number}`,
                        shareMessage(detailSale)
                      ),
                      '_self'
                    )
                  }
                >
                  <Mail size={16} />
                  Email
                </Button>
              </>
            )}
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

      {returnTarget && (
        <ReturnModal
          item={returnTarget}
          onClose={() => setReturnTarget(null)}
          onConfirm={async (quantity, reason, refundMethod) => {
            const result = await returnSaleItem(returnTarget.id, quantity, reason, refundMethod)
            if (!result.error) {
              setReturnTarget(null)
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

function ReturnModal({
  item,
  onClose,
  onConfirm,
}: {
  item: SaleItem
  onClose: () => void
  onConfirm: (quantity: number, reason: string, refundMethod: PaymentMethod | 'ninguno') => Promise<{ error: string | null }>
}) {
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod | 'ninguno'>('efectivo')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qtyNum = Number(quantity) || 0
  const refundAmount = item.sold_price * qtyNum

  async function handleConfirm() {
    if (!qtyNum || qtyNum <= 0 || qtyNum > item.quantity) {
      setError(`Cantidad inválida (máximo ${item.quantity})`)
      return
    }
    if (!reason.trim()) {
      setError('Indica un motivo')
      return
    }
    setSaving(true)
    const result = await onConfirm(qtyNum, reason.trim(), refundMethod)
    setSaving(false)
    if (result.error) setError(result.error)
  }

  return (
    <Modal open onClose={onClose} title="Devolver producto">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Cantidad vendida: {item.quantity} · Precio unitario: {formatCLP(item.sold_price)}
        </p>
        <Input label="Cantidad a devolver" type="number" min={1} max={item.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Select label="Devolución" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod | 'ninguno')}>
          <option value="efectivo">Reembolso en efectivo</option>
          <option value="tarjeta">Reembolso con tarjeta (fuera del sistema)</option>
          <option value="transferencia">Reembolso por transferencia (fuera del sistema)</option>
          <option value="ninguno">Sin reembolso (solo reingresar a stock)</option>
        </Select>
        <p className="text-sm font-medium text-slate-700">Monto a devolver: {formatCLP(refundAmount)}</p>
        {refundMethod === 'efectivo' && (
          <p className="text-xs text-amber-600">Se descontará de la caja abierta de esta sucursal.</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Procesando...' : 'Confirmar devolución'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
