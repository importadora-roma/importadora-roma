import { useMemo, useState } from 'react'
import { Eye, Mail, MessageCircle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { formatCLP, formatDate, formatDateTime, formatKilo } from '@/lib/format'
import { whatsappUrl, mailtoUrl } from '@/lib/share'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useCustomers } from '@/features/customers/useCustomers'
import { useQuotations, type Quotation, type QuotationItem } from './useQuotations'
import { PaymentSplit, type PaymentLine } from '@/features/sales/PaymentSplit'
import { generateQuotationPdf } from './quotationPdf'

const statusLabels: Record<string, string> = { pending: 'Pendiente', converted: 'Convertida', expired: 'Expirada', cancelled: 'Cancelada' }
const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  converted: 'bg-green-100 text-green-700',
  expired: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-red-100 text-red-700',
}

export function QuotationsHistoryPage() {
  const profile = useAuthStore((s) => s.profile)
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const { products, variants } = useProducts()
  const { customers } = useCustomers()
  const [branchId, setBranchId] = useState(activeBranchId)

  const { quotations, loading, error, loadQuotationItems, convertToSale, cancelQuotation } = useQuotations(branchId)

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

  const [detail, setDetail] = useState<Quotation | null>(null)
  const [detailItems, setDetailItems] = useState<QuotationItem[]>([])
  const [convertOpen, setConvertOpen] = useState(false)
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'efectivo', amount: '' }])
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function openDetail(q: Quotation) {
    setDetail(q)
    setActionError(null)
    const { items } = await loadQuotationItems(q.id)
    setDetailItems(items)
  }

  function openConvert() {
    setPayments([{ method: 'efectivo', amount: detail ? String(detail.total) : '' }])
    setActionError(null)
    setConvertOpen(true)
  }

  async function handleConvert() {
    if (!detail) return
    const paymentsPayload = payments.filter((p) => Number(p.amount) > 0).map((p) => ({ payment_method: p.method, amount: Number(p.amount) }))
    const paymentsTotal = paymentsPayload.reduce((s, p) => s + p.amount, 0)
    if (Math.round(paymentsTotal) !== Math.round(detail.total)) {
      setActionError(`El total de pagos (${formatCLP(paymentsTotal)}) no coincide con el total (${formatCLP(detail.total)})`)
      return
    }
    setSaving(true)
    const result = await convertToSale(detail.id, paymentsPayload)
    setSaving(false)
    if (result.error) {
      setActionError(result.error)
      return
    }
    setConvertOpen(false)
    setDetail(null)
  }

  function shareMessage(q: Quotation): string {
    const lines = [
      `Cotización ${q.quotation_number}`,
      ...detailItems.map((item) => {
        const variant = variantById.get(item.variant_id)
        const name = variant ? productNameById.get(variant.product_id) ?? '—' : '—'
        return `- ${item.quantity} x ${name}${variant ? ` (${variant.calidad} ${formatKilo(variant.kilo)})` : ''}: ${formatCLP(item.unit_price * item.quantity)}`
      }),
      `Total: ${formatCLP(q.total)}`,
      q.valid_until ? `Válida hasta: ${formatDate(q.valid_until)}` : '',
    ]
    return lines.filter(Boolean).join('\n')
  }

  async function handleCancel() {
    if (!detail) return
    setSaving(true)
    const result = await cancelQuotation(detail.id)
    setSaving(false)
    if (result.error) {
      setActionError(result.error)
      return
    }
    setDetail(null)
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
            {!loading && quotations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Sin cotizaciones todavía.
                </td>
              </tr>
            )}
            {quotations.map((q) => (
              <tr key={q.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{q.quotation_number}</td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(q.created_at)}</td>
                <td className="px-4 py-3 text-slate-600">{q.customer_id ? customerNameById.get(q.customer_id) ?? '—' : '—'}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{formatCLP(q.total)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[q.status]}`}>{statusLabels[q.status]}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openDetail(q)} className="text-slate-400 hover:text-slate-700">
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Cotización ${detail?.quotation_number ?? ''}`}>
        <div className="space-y-4">
          {detail?.valid_until && <p className="text-sm text-slate-500">Válida hasta: {formatDate(detail.valid_until)}</p>}
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1 pr-2">Cant.</th>
                <th className="py-1">Precio</th>
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
                    <td className="py-1.5">{formatCLP(item.unit_price)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {actionError && <p className="text-sm text-red-600">{actionError}</p>}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                detail &&
                generateQuotationPdf(detail, detailItems, {
                  branchName: branchNameById.get(detail.branch_id) ?? '',
                  branchAddress: branchAddressById.get(detail.branch_id) ?? null,
                  customerName: detail.customer_id ? customerNameById.get(detail.customer_id) ?? null : null,
                  variantLabel,
                })
              }
            >
              <Printer size={16} />
              Imprimir
            </Button>
            {detail && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => window.open(whatsappUrl(detail.customer_id ? customerById.get(detail.customer_id)?.phone ?? null : null, shareMessage(detail)), '_blank')}
                >
                  <MessageCircle size={16} />
                  WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      mailtoUrl(
                        detail.customer_id ? customerById.get(detail.customer_id)?.email ?? null : null,
                        `Cotización ${detail.quotation_number}`,
                        shareMessage(detail)
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
            {detail?.status === 'pending' && (
              <>
                <Button onClick={openConvert}>Convertir en venta</Button>
                <Button variant="danger" onClick={handleCancel} disabled={saving}>
                  Cancelar
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title="Convertir en venta">
        <div className="space-y-4">
          <PaymentSplit payments={payments} total={detail?.total ?? 0} onChange={setPayments} allowCredit={!!detail?.customer_id} />
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConvertOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConvert} disabled={saving}>
              {saving ? 'Procesando...' : 'Confirmar venta'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
