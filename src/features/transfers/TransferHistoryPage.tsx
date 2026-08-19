import { useMemo, useState } from 'react'
import { Eye, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatDateTime, formatKilo } from '@/lib/format'
import { useBranches } from '@/features/branches/useBranches'
import { useProducts } from '@/features/products/useProducts'
import { useTransfers, type Transfer, type TransferItem } from './useTransfers'
import { generateTransferPdf } from './transferPdf'

const statusLabels: Record<string, string> = { en_transito: 'En tránsito', recibido: 'Recibido', cancelado: 'Cancelado' }
const statusColors: Record<string, string> = {
  en_transito: 'bg-amber-100 text-amber-700',
  recibido: 'bg-green-100 text-green-700',
  cancelado: 'bg-slate-100 text-slate-500',
}

export function TransferHistoryPage() {
  const { branches } = useBranches()
  const { products, variants } = useProducts()
  const { transfers, loading, error, loadTransferItems, receiveTransfer } = useTransfers()

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])

  function variantLabel(variantId: string): string {
    const variant = variantById.get(variantId)
    if (!variant) return '—'
    const productName = productNameById.get(variant.product_id) ?? '—'
    return `${productName} — ${variant.calidad} ${formatKilo(variant.kilo)}`
  }

  const [detail, setDetail] = useState<Transfer | null>(null)
  const [detailItems, setDetailItems] = useState<TransferItem[]>([])
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)

  async function openDetail(transfer: Transfer) {
    setDetail(transfer)
    setReceiveError(null)
    const { items } = await loadTransferItems(transfer.id)
    setDetailItems(items)
  }

  async function handleReceive() {
    if (!detail) return
    setReceiving(true)
    const result = await receiveTransfer(detail.id)
    setReceiving(false)
    if (result.error) {
      setReceiveError(result.error)
      return
    }
    setDetail(null)
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Folio</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Origen</th>
              <th className="px-4 py-3">Destino</th>
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
            {!loading && transfers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Sin traslados todavía.
                </td>
              </tr>
            )}
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{t.transfer_number}</td>
                <td className="px-4 py-3 text-slate-500">{formatDateTime(t.sent_at)}</td>
                <td className="px-4 py-3 text-slate-600">{branchNameById.get(t.origin_branch_id) ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{branchNameById.get(t.destination_branch_id) ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[t.status]}`}>{statusLabels[t.status]}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openDetail(t)} className="text-slate-400 hover:text-slate-700">
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Traslado ${detail?.transfer_number ?? ''}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {branchNameById.get(detail?.origin_branch_id ?? '')} → {branchNameById.get(detail?.destination_branch_id ?? '')}
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1">Cantidad</th>
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
                    <td className="py-1.5">{item.quantity}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {detail?.notes && <p className="text-sm text-slate-500">Notas: {detail.notes}</p>}
          {receiveError && <p className="text-sm text-red-600">{receiveError}</p>}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                detail &&
                generateTransferPdf(detail, detailItems, {
                  originName: branchNameById.get(detail.origin_branch_id) ?? '',
                  destinationName: branchNameById.get(detail.destination_branch_id) ?? '',
                  variantLabel,
                })
              }
            >
              <Printer size={16} />
              Imprimir guía
            </Button>
            {detail?.status === 'en_transito' && (
              <Button onClick={handleReceive} disabled={receiving}>
                {receiving ? 'Confirmando...' : 'Marcar como recibido'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
