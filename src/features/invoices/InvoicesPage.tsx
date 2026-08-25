import { useMemo, useState } from 'react'
import { ClipboardCopy, Eye } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatDateTime, formatKilo } from '@/lib/format'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import { useInvoices, loadInvoiceLines, type InvoiceQueueRow } from './useInvoices'
import type { SaleItem } from '@/features/sales/useSales'

const IVA_RATE = 0.19

type Filter = 'pending' | 'issued' | 'cancelled' | 'all'

const statusLabels: Record<InvoiceQueueRow['status'], string> = {
  pending: 'PENDIENTE',
  issued: 'EMITIDA',
  cancelled: 'CANCELADA',
}

const statusClass: Record<InvoiceQueueRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  issued: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

interface InvoiceLine {
  productName: string
  variantLabel: string
  quantity: number
  grossUnit: number
  netUnit: number
  grossLine: number
  netLine: number
  ivaLine: number
}

export function InvoicesPage() {
  const { branchId } = useEffectiveBranch()
  const { invoices, loading, issueInvoice, cancelInvoice } = useInvoices(branchId)
  const { products, variants } = useProducts()
  const [filter, setFilter] = useState<Filter>('pending')
  const [detail, setDetail] = useState<InvoiceQueueRow | null>(null)
  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [issueTarget, setIssueTarget] = useState<InvoiceQueueRow | null>(null)
  const [siiFolio, setSiiFolio] = useState('')
  const [cancelTarget, setCancelTarget] = useState<InvoiceQueueRow | null>(null)
  const [copyOk, setCopyOk] = useState(false)

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])

  const filtered = invoices.filter((inv) => filter === 'all' || inv.status === filter)

  async function openDetail(invoice: InvoiceQueueRow) {
    setDetail(invoice)
    setCopyOk(false)
    const { items } = await loadInvoiceLines(invoice.sale_id)
    setLines(buildLines(items, productNameById, variantById))
  }

  function copyForSii(invoice: InvoiceQueueRow) {
    const rows = lines
      .map((l) => `${l.productName} (${l.variantLabel}) x${l.quantity} — Neto unit.: ${formatCLP(l.netUnit)} — Total neto: ${formatCLP(l.netLine)}`)
      .join('\n')
    const text = [
      `Cliente: ${invoice.customer_name ?? '—'}`,
      `RUT: ${invoice.customer_rut ?? '—'}`,
      `Venta: ${invoice.sale_number ?? '—'}`,
      '',
      rows,
      '',
      `NETO: ${formatCLP(invoice.net_total)}`,
      `IVA (19%): ${formatCLP(invoice.iva_total)}`,
      `TOTAL: ${formatCLP(invoice.gross_total)}`,
    ].join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 2000)
    })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Facturas</h1>
      <p className="mt-1 text-sm text-slate-500">
        Ventas marcadas como "requiere factura". El neto e IVA se calculan automáticamente para ingresarlos en el SII —
        este sistema no emite facturas electrónicas reales.
      </p>

      <div className="mt-4 flex gap-2">
        {(['pending', 'issued', 'cancelled', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f === 'pending' ? 'Pendientes' : f === 'issued' ? 'Emitidas' : f === 'cancelled' ? 'Canceladas' : 'Todas'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">Cargando...</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Folio</th>
                <th className="px-4 py-2">Venta</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">RUT</th>
                <th className="px-4 py-2 text-right">Neto</th>
                <th className="px-4 py-2 text-right">IVA</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((inv) => (
                <tr key={inv.invoice_id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{inv.internal_number}</td>
                  <td className="px-4 py-3 text-slate-600">{inv.sale_number}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(inv.created_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{inv.customer_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{inv.customer_rut ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{formatCLP(inv.net_total)}</td>
                  <td className="px-4 py-3 text-right">{formatCLP(inv.iva_total)}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCLP(inv.gross_total)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[inv.status]}`}>{statusLabels[inv.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openDetail(inv)} className="text-slate-400 hover:text-slate-700">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                    Sin facturas en esta categoría.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Factura ${detail?.internal_number ?? ''}`}>
        {detail && (
          <div className="space-y-4">
            <div className="text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">Cliente:</span> {detail.customer_name ?? '—'}
              </p>
              <p>
                <span className="font-medium text-slate-800">RUT:</span> {detail.customer_rut ?? '—'}
              </p>
              <p>
                <span className="font-medium text-slate-800">Venta:</span> {detail.sale_number}
              </p>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Producto</th>
                    <th className="px-2 py-1.5 text-right">Cant.</th>
                    <th className="px-2 py-1.5 text-right">P. unit. neto</th>
                    <th className="px-2 py-1.5 text-right">Total neto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        {l.productName} — {l.variantLabel}
                      </td>
                      <td className="px-2 py-1.5 text-right">{l.quantity}</td>
                      <td className="px-2 py-1.5 text-right">{formatCLP(l.netUnit)}</td>
                      <td className="px-2 py-1.5 text-right">{formatCLP(l.netLine)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Neto</span>
                <span className="font-medium">{formatCLP(detail.net_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">IVA ({Math.round(IVA_RATE * 100)}%)</span>
                <span className="font-medium">{formatCLP(detail.iva_total)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-base">
                <span className="font-medium text-slate-800">Total</span>
                <span className="font-semibold text-slate-900">{formatCLP(detail.gross_total)}</span>
              </div>
            </div>

            {detail.status === 'issued' && (
              <p className="text-sm text-green-700">
                Emitida el {detail.issued_at ? formatDateTime(detail.issued_at) : ''}
                {detail.sii_folio ? ` — Folio SII: ${detail.sii_folio}` : ''}
              </p>
            )}
            {detail.status === 'cancelled' && detail.cancel_reason && (
              <p className="text-sm text-red-600">Motivo de cancelación: {detail.cancel_reason}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => copyForSii(detail)}>
                <ClipboardCopy size={16} /> {copyOk ? 'Copiado' : 'Copiar para SII'}
              </Button>
              {detail.status === 'pending' && (
                <>
                  <Button
                    onClick={() => {
                      setIssueTarget(detail)
                      setSiiFolio('')
                    }}
                  >
                    Marcar como emitida
                  </Button>
                  <Button variant="danger" onClick={() => setCancelTarget(detail)}>
                    Cancelar factura
                  </Button>
                </>
              )}
              {detail.status === 'issued' && (
                <Button variant="danger" onClick={() => setCancelTarget(detail)}>
                  Cancelar factura
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!issueTarget} onClose={() => setIssueTarget(null)} title="Marcar factura como emitida">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Confirma que ya emitiste esta factura en el SII. Puedes indicar el folio real para tu propia referencia
            (opcional).
          </p>
          <Input label="Folio SII (opcional)" value={siiFolio} onChange={(e) => setSiiFolio(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIssueTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!issueTarget) return
                const { error } = await issueInvoice(issueTarget.invoice_id, siiFolio)
                if (!error) {
                  setIssueTarget(null)
                  setDetail(null)
                }
              }}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={`Cancelar factura ${cancelTarget?.internal_number ?? ''}`}
        confirmLabel="Cancelar factura"
        onConfirm={async (reason) => {
          const result = await cancelInvoice(cancelTarget!.invoice_id, reason)
          if (!result.error) {
            setDetail(null)
          }
          return result
        }}
      />
    </div>
  )
}

function buildLines(
  items: SaleItem[],
  productNameById: Map<string, string>,
  variantById: Map<string, { product_id: string; calidad: string; kilo: number }>
): InvoiceLine[] {
  return items.map((item) => {
    const variant = variantById.get(item.variant_id)
    const productName = variant ? productNameById.get(variant.product_id) ?? '—' : '—'
    const variantLabel = variant ? `${variant.calidad} ${formatKilo(variant.kilo)}` : '—'
    const grossUnit = item.sold_price
    const netUnit = Math.round(grossUnit / (1 + IVA_RATE))
    const grossLine = item.line_total
    const netLine = netUnit * item.quantity
    const ivaLine = grossLine - netLine
    return { productName, variantLabel, quantity: item.quantity, grossUnit, netUnit, grossLine, netLine, ivaLine }
  })
}
