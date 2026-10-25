import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, PackagePlus, PackageMinus, FileDown, Trash2, Eye, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { addDaysCL, dateCL, formatCLP, formatDate, formatKilo, formatTimeCL, todayCL } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useBranches } from '@/features/branches/useBranches'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'
import { useSaleCatalog, type CatalogEntry } from '@/features/sales/useSaleCatalog'
import { ProductSearch } from '@/features/sales/ProductSearch'
import { PaymentSplit, type PaymentLine } from '@/features/sales/PaymentSplit'
import { useSales, type Sale, type SaleItem, type SalePayment } from '@/features/sales/useSales'
import { ExchangeModal, ReturnModal } from '@/features/sales/SalesHistoryPage'
import { useTransfers, type Transfer, type TransferItem } from '@/features/transfers/useTransfers'
import { generateTransferPdf } from '@/features/transfers/transferPdf'
import { generateFurgonStockReportPdf } from './furgonStockPdf'
import { generateFurgonLoadsReportPdf, type FurgonLoadEntry } from './furgonLoadsPdf'
import type { SalePaymentMethod } from '@/types/database'

const DRIVER_NAME_KEY = 'furgon_driver_name'
// sales/sale_items/sale_payments RLS and useSales both key off branch_id —
// before furgonBranchId has loaded, fall back to an id that matches no
// real branch so the query returns nothing instead of silently running
// unscoped (useSales treats an empty branchId as "all branches", correct
// for the admin-wide Historial screen but wrong here).
const NO_BRANCH_ID = '00000000-0000-0000-0000-000000000000'
// Fardos sold off the van default to catalog price + this markup — a
// Furgón-only surcharge, still editable per line before confirming the sale.
const FURGON_PRICE_MARKUP = 5000

const paymentLabels: Record<SalePaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
}

interface MoveLine {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  quantity: number
  unitPrice: string
}

// Loading the van: moves stock OUT of a real branch and INTO the Furgón
// branch via furgon_load_stock, a one-step transfer that's also recorded
// in Transferencias like any other (auditable, and the existing "Guía de
// traslado" PDF works for it unmodified — just relabeled here).
function LoadStockModal({
  open,
  onClose,
  branches,
  defaultBranchId,
  reloadInventory,
  onDone,
}: {
  open: boolean
  onClose: () => void
  branches: { id: string; name: string; address: string | null }[]
  defaultBranchId: string
  reloadInventory: () => void
  onDone: () => void
}) {
  function pickDefault(list: { id: string }[]) {
    // Default to whatever branch the user is currently operating in (e.g.
    // Zenteno) — almost always the branch they actually want to load fardos
    // from — but fall back to the first one if that branch isn't in the list
    // (admin viewing a branch that's inactive, or not loaded yet).
    if (defaultBranchId && list.some((b) => b.id === defaultBranchId)) return defaultBranchId
    return list[0]?.id ?? ''
  }
  const [originBranchId, setOriginBranchId] = useState(pickDefault(branches))
  // useSaleCatalog calls useInventory() itself — a separate instance from
  // FurgonPage's own, fetched once on mount and never polled. Reloading the
  // page-level inventory does NOT refresh the stock numbers this modal
  // reads, so its own reloadInventory must be called too, or "disponible"
  // (and the insufficient-stock check below) stays frozen at whatever it
  // was when the page first loaded, however many loads/unloads happen.
  const { catalog, reloadInventory: reloadCatalogInventory } = useSaleCatalog(originBranchId)
  const [lines, setLines] = useState<MoveLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setOriginBranchId(pickDefault(branches))
      setLines([])
      setError(null)
      reloadCatalogInventory()
      reloadInventory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branches, defaultBranchId])

  function addLine(entry: CatalogEntry) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === entry.variantId)
      if (existing) return prev.map((l) => (l.variantId === entry.variantId ? { ...l, quantity: l.quantity + 1 } : l))
      // Furgón-only: the guía for loading the van defaults to catalog price
      // plus the same Furgón markup as a sale (regular traslados default to
      // plain catalog price) — editable per line before submitting.
      return [...prev, { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, quantity: 1, unitPrice: String(entry.price + FURGON_PRICE_MARKUP) }]
    })
  }

  function updateLine(variantId: string, patch: Partial<MoveLine>) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)))
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }

  function availableStock(variantId: string): number {
    return catalog.find((c) => c.variantId === variantId)?.stock ?? 0
  }

  async function handleSubmit() {
    setError(null)
    if (!originBranchId) {
      setError('Selecciona la sucursal de origen')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    // Branch stock counts are known to be stale/unreliable, same reasoning
    // sales already follow (create_sale, migration 0006): loading never
    // blocks on "insufficient" stock — furgon_load_stock lets it go
    // negative rather than reject the whole batch over a number nobody
    // trusts anyway. "Disponible" below is shown for reference only.
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('furgon_load_stock', {
      p_origin_branch_id: originBranchId,
      p_items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, unit_price: Number(l.unitPrice) || null })),
      p_notes: null,
    })
    if (rpcError) {
      setSaving(false)
      setError(rpcError.message)
      return
    }

    const transferId = data as string
    const origin = branches.find((b) => b.id === originBranchId)
    const { data: transferRow } = await supabase.from('transfers').select('*').eq('id', transferId).single()
    const { data: itemRows } = await supabase.from('transfer_items').select('*').eq('transfer_id', transferId)
    setSaving(false)

    if (transferRow && origin) {
      // variantLabel is built from the lines just submitted — cheap, no refetch needed.
      const labelByVariant = new Map(lines.map((l) => [l.variantId, `${l.productName} — ${l.calidad}${l.kilo ? ` ${formatKilo(l.kilo)}` : ''}`]))
      await generateTransferPdf(transferRow as unknown as Transfer, (itemRows ?? []) as unknown as TransferItem[], {
        originName: origin.name,
        originAddress: origin.address,
        destinationName: 'Furgón',
        variantLabel: (variantId) => labelByVariant.get(variantId) ?? '—',
        title: 'Guía de despacho',
      })
    }

    onDone()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Cargar stock al furgón" size="xl">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Sucursal de origen</label>
          <Select value={originBranchId} onChange={(e) => setOriginBranchId(e.target.value)} className="mt-1">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        {lines.length > 0 && (
          // Kept above the product picker: with the list below now always
          // visible and tall, items already added would otherwise scroll out
          // of view every time — staff lost track of what they'd picked.
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 px-2">Producto</th>
                  <th className="py-1.5 px-2">Cant.</th>
                  <th className="py-1.5 px-2">Disponible</th>
                  <th className="py-1.5 px-2">Precio</th>
                  <th className="py-1.5 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => {
                  const available = availableStock(l.variantId)
                  const short = l.quantity > available
                  return (
                    <tr key={l.variantId} className={short ? 'bg-red-50' : undefined}>
                      <td className="py-1.5 px-2">
                        <span className="font-medium text-slate-900">{l.productName}</span>
                        <span className="text-slate-500"> — {l.calidad} {formatKilo(l.kilo)}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.variantId, { quantity: Math.max(1, Number(e.target.value)) })}
                          className={`w-16 rounded-md border px-2 py-1 text-sm ${short ? 'border-red-400' : 'border-slate-300'}`}
                        />
                      </td>
                      <td className={`py-1.5 px-2 ${short ? 'font-medium text-red-600' : 'text-slate-500'}`}>{available}</td>
                      <td className="py-1.5 px-2">
                        <input
                          type="number"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(l.variantId, { unitPrice: e.target.value })}
                          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <button onClick={() => removeLine(l.variantId)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <ProductSearch catalog={catalog} onSelect={addLine} branchId={originBranchId} resultsMaxHeight="22rem" alwaysOpen />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || lines.length === 0}>
            {saving ? 'Cargando...' : 'Cargar y generar guía'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Unloading the van: the reverse — fardos the vendedor didn't sell going
// back into a real branch's stock. Capped to what's actually on the van.
function UnloadStockModal({
  open,
  onClose,
  branches,
  furgonBranchId,
  defaultBranchId,
  reloadInventory,
  onDone,
}: {
  open: boolean
  onClose: () => void
  branches: { id: string; name: string; address: string | null }[]
  furgonBranchId: string
  defaultBranchId: string
  reloadInventory: () => void
  onDone: () => void
}) {
  function pickDefault(list: { id: string }[]) {
    // Same reasoning as LoadStockModal: default to the branch the user is
    // currently operating in — almost always where the van's unsold fardos
    // should go back to.
    if (defaultBranchId && list.some((b) => b.id === defaultBranchId)) return defaultBranchId
    return list[0]?.id ?? ''
  }
  const [destinationBranchId, setDestinationBranchId] = useState(pickDefault(branches))
  // See the comment in LoadStockModal: useSaleCatalog's own useInventory()
  // instance is independent of the page-level one, so it needs its own reload.
  const { catalog, reloadInventory: reloadCatalogInventory } = useSaleCatalog(furgonBranchId)
  const [lines, setLines] = useState<MoveLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDestinationBranchId(pickDefault(branches))
      setLines([])
      setError(null)
      reloadCatalogInventory()
      reloadInventory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branches, defaultBranchId])

  function addLine(entry: CatalogEntry) {
    if (entry.stock <= 0) {
      // Clicking used to just silently do nothing here — looked like the
      // screen wasn't responding at all, especially right after the stock
      // snapshot had gone stale (see reloadInventory above).
      setError(`${entry.productName} — ${entry.calidad} ${formatKilo(entry.kilo)} no tiene stock en el furgón.`)
      return
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === entry.variantId)
      if (existing) {
        if (existing.quantity >= entry.stock) {
          setError(`Ya agregaste todo el stock disponible de ${entry.productName} — ${entry.calidad} ${formatKilo(entry.kilo)} (${entry.stock}).`)
          return prev
        }
        setError(null)
        return prev.map((l) => (l.variantId === entry.variantId ? { ...l, quantity: l.quantity + 1 } : l))
      }
      setError(null)
      return [...prev, { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, quantity: 1, unitPrice: String(entry.price) }]
    })
  }

  function updateLineQty(variantId: string, quantity: number, max: number) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(Math.max(1, quantity), max) } : l)))
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }

  async function handleSubmit() {
    setError(null)
    if (!destinationBranchId) {
      setError('Selecciona la sucursal de destino')
      return
    }
    if (lines.length === 0) {
      setError('Agrega al menos un producto')
      return
    }
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('furgon_unload_stock', {
      p_destination_branch_id: destinationBranchId,
      p_items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
      p_notes: null,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    onDone()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Descargar stock del furgón" size="xl">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">Sucursal de destino</label>
          <Select value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)} className="mt-1">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>

        {lines.length > 0 && (
          // Kept above the product picker — see the same comment in
          // LoadStockModal: otherwise already-added items scroll out of
          // view behind the (now tall, always-visible) product list.
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 px-2">Producto</th>
                  <th className="py-1.5 px-2">Cant.</th>
                  <th className="py-1.5 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => {
                  const max = catalog.find((c) => c.variantId === l.variantId)?.stock ?? l.quantity
                  return (
                    <tr key={l.variantId}>
                      <td className="py-1.5 px-2">
                        <span className="font-medium text-slate-900">{l.productName}</span>
                        <span className="text-slate-500"> — {l.calidad} {formatKilo(l.kilo)}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="number"
                          min={1}
                          max={max}
                          value={l.quantity}
                          onChange={(e) => updateLineQty(l.variantId, Number(e.target.value), max)}
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="ml-1 text-xs text-slate-400">/ {max}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <button onClick={() => removeLine(l.variantId)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* No search box here on purpose — descargar only ever deals with
            what's physically on the van, so the list below IS the furgón's
            own stock (what the "Fardos a bordo" table on the main page
            shows); click a fardo to move it into "a descargar" above. */}
        <div>
          <p className="text-xs font-medium text-slate-600">Fardos en el furgón — toca uno para agregarlo</p>
          <div className="mt-1 max-h-[22rem] overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 px-2">Producto</th>
                  <th className="py-1.5 px-2 text-right">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalog.filter((c) => c.stock > 0).length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-2 py-4 text-center text-slate-400">
                      El furgón no tiene fardos cargados.
                    </td>
                  </tr>
                )}
                {catalog
                  .filter((c) => c.stock > 0)
                  .sort((a, b) => b.stock - a.stock)
                  .map((c) => {
                    const added = lines.find((l) => l.variantId === c.variantId)?.quantity ?? 0
                    return (
                      <tr key={c.variantId} className="cursor-pointer hover:bg-slate-50" onClick={() => addLine(c)}>
                        <td className="py-1.5 px-2">
                          <span className="font-medium text-slate-900">{c.productName}</span>
                          <span className="text-slate-500"> — {c.calidad} {formatKilo(c.kilo)}</span>
                          {added > 0 && <span className="ml-1.5 text-xs text-emerald-600">({added} agregado{added === 1 ? '' : 's'})</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-600">{c.stock}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || lines.length === 0}>
            {saving ? 'Descargando...' : 'Descargar del furgón'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface QuickSaleLine {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  price: string
  quantity: number
}

interface ItemSummary {
  key: string
  label: string
  quantity: number
}

interface DailySalesSummary {
  date: string
  saleCount: number
  fardoCount: number
  total: number
}

// The Furgón tab: a dedicated branch's worth of stock (what's physically
// loaded on the van right now, nothing else — not a store's full catalog),
// a simple way to load/unload it, and a quick form for entering what the
// driver reports selling. Sales here are tagged is_terreno — same flag a
// regular Ventas-screen "Vendido en terreno" checkbox sets — so this feed
// and the Furgón's own branch stay in sync with the rest of the system
// regardless of which screen a terreno sale was entered from.
export function FurgonPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  // Moving real stock between branches (load/unload) stays admin/supervisor-only,
  // same as Transferencias/Inventario — but any vendedor can now reach this tab
  // and register what the driver sold, same as the normal Ventas screen.
  const canManageStock = profile?.role === 'admin' || profile?.role === 'supervisor'
  // Whatever branch the user is currently operating in (topbar switcher for
  // admins, their own home branch otherwise) — the sensible default for
  // "which branch am I loading fardos from" on the Cargar stock modal.
  const { branchId: effectiveBranchId } = useEffectiveBranch()
  const { branches, loading: loadingBranches } = useBranches()
  const furgonBranch = branches.find((b) => b.is_furgon) ?? null
  const furgonBranchId = furgonBranch?.id ?? ''
  const otherBranches = useMemo(() => branches.filter((b) => !b.is_furgon && b.active), [branches])

  const { products, variants, loading: loadingProducts } = useProducts()
  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const { inventory, loading: loadingInventory, reload: reloadInventory } = useInventory()
  const { catalog } = useSaleCatalog(furgonBranchId)
  const { loadTransferItems } = useTransfers()

  // Period for every sales figure on this page (card, daily breakdown,
  // product breakdown, recent-sales list) — staff can widen or narrow it
  // instead of always being stuck with a fixed last-30-days window.
  const [salesFrom, setSalesFrom] = useState(addDaysCL(-30))
  const [salesTo, setSalesTo] = useState(todayCL())
  const {
    sales,
    loading: loadingSales,
    reload: reloadSales,
    loadSaleDetail,
    cancelSale,
    exchangeSaleItem,
    returnSaleItem,
  } = useSales(furgonBranchId || NO_BRANCH_ID, { from: salesFrom, to: salesTo })
  // The card and breakdown totals only count completed sales — an anulled
  // one shouldn't still look like it happened.
  const completedSales = useMemo(() => sales.filter((s) => s.status === 'completed'), [sales])

  function variantLabel(variantId: string): string {
    const variant = variantById.get(variantId)
    if (!variant) return '—'
    return `${productNameById.get(variant.product_id) ?? '—'} — ${variant.calidad} ${formatKilo(variant.kilo)}`
  }

  const [detailSale, setDetailSale] = useState<Sale | null>(null)
  const [detailItems, setDetailItems] = useState<SaleItem[]>([])
  const [detailPayments, setDetailPayments] = useState<SalePayment[]>([])
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null)
  const [exchangeTarget, setExchangeTarget] = useState<SaleItem | null>(null)
  const [returnTarget, setReturnTarget] = useState<SaleItem | null>(null)

  async function openSaleDetail(sale: Sale) {
    setDetailSale(sale)
    const { items, payments } = await loadSaleDetail(sale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  async function refreshSaleDetail() {
    if (!detailSale) return
    const { items, payments } = await loadSaleDetail(detailSale.id)
    setDetailItems(items)
    setDetailPayments(payments)
  }

  const [driverName, setDriverName] = useState('')
  useEffect(() => {
    setDriverName(localStorage.getItem(DRIVER_NAME_KEY) ?? '')
  }, [])
  useEffect(() => {
    try {
      if (driverName) localStorage.setItem(DRIVER_NAME_KEY, driverName)
    } catch {
      // ignore — purely a convenience default, not critical state
    }
  }, [driverName])

  const [cart, setCart] = useState<QuickSaleLine[]>([])
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'efectivo', amount: '' }])
  const [saleError, setSaleError] = useState<string | null>(null)
  const [saleSaving, setSaleSaving] = useState(false)
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null)

  const [loadOpen, setLoadOpen] = useState(false)
  const [unloadOpen, setUnloadOpen] = useState(false)

  interface MovementRow {
    id: string
    transfer_number: string | null
    kind: 'load' | 'unload'
    otherBranchName: string
    sent_at: string
  }
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loadingMovements, setLoadingMovements] = useState(false)

  async function reloadMovements() {
    if (!furgonBranchId) return
    setLoadingMovements(true)
    const { data } = await supabase
      .from('transfers')
      .select('id, transfer_number, origin_branch_id, destination_branch_id, sent_at')
      .or(`origin_branch_id.eq.${furgonBranchId},destination_branch_id.eq.${furgonBranchId}`)
      .order('sent_at', { ascending: false })
      .limit(10)
    const branchNameById = new Map(branches.map((b) => [b.id, b.name]))
    setMovements(
      (data ?? []).map((t) => ({
        id: t.id as string,
        transfer_number: t.transfer_number as string | null,
        kind: (t.destination_branch_id as string) === furgonBranchId ? 'load' : 'unload',
        otherBranchName:
          branchNameById.get((t.destination_branch_id as string) === furgonBranchId ? (t.origin_branch_id as string) : (t.destination_branch_id as string)) ?? '—',
        sent_at: t.sent_at as string,
      }))
    )
    setLoadingMovements(false)
  }

  useEffect(() => {
    reloadMovements()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furgonBranchId])

  async function reprintGuide(movementId: string) {
    const { items, error } = await loadTransferItems(movementId)
    if (error) return
    const { data: transferRow } = await supabase.from('transfers').select('*').eq('id', movementId).single()
    if (!transferRow) return
    const t = transferRow as unknown as Transfer
    const origin = branches.find((b) => b.id === t.origin_branch_id)
    const destination = branches.find((b) => b.id === t.destination_branch_id)
    const variantLabelById = new Map(
      variants.map((v) => [v.id, `${productNameById.get(v.product_id) ?? '—'} — ${v.calidad}${v.kilo ? ` ${formatKilo(v.kilo)}` : ''}`])
    )
    await generateTransferPdf(t, items, {
      originName: origin?.name ?? '—',
      originAddress: origin?.address ?? null,
      destinationName: destination?.name ?? '—',
      variantLabel: (variantId) => variantLabelById.get(variantId) ?? '—',
      title: 'Guía de despacho',
    })
  }

  const [stockReportLoading, setStockReportLoading] = useState(false)

  // Simple snapshot — what's physically on the van right now, same rows as
  // the "Fardos a bordo" table, as a downloadable PDF.
  async function handlePrintStockReport() {
    setStockReportLoading(true)
    await generateFurgonStockReportPdf(
      stockRows.map((r) => ({
        productName: r.productName,
        calidad: r.variant.calidad,
        kilo: r.variant.kilo,
        quantity: r.stock,
        price: r.variant.price,
      }))
    )
    setStockReportLoading(false)
  }

  const [reportFrom, setReportFrom] = useState(addDaysCL(-30))
  const [reportTo, setReportTo] = useState(todayCL())
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  function shiftDate(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
  }

  async function handlePrintLoadsReport() {
    if (!furgonBranchId) return
    setReportError(null)
    setReportLoading(true)
    // sent_at is a UTC instant, reportFrom/reportTo are Chile-local calendar
    // dates — same buffered-fetch-then-filter approach as useTransferValue,
    // to avoid the day-boundary bug that approach was built to fix.
    const { data: rawTransfers, error: transfersError } = await supabase
      .from('transfers')
      .select('*')
      .eq('destination_branch_id', furgonBranchId)
      // A cancelled load didn't actually put anything on the van — excluding
      // it keeps the report matching what's really there, not what was
      // later undone (e.g. via "Anular traslado").
      .neq('status', 'cancelado')
      .gte('sent_at', `${shiftDate(reportFrom, -1)}T00:00:00Z`)
      .lte('sent_at', `${shiftDate(reportTo, 1)}T23:59:59Z`)
      .order('sent_at', { ascending: true })
    if (transfersError) {
      setReportError(transfersError.message)
      setReportLoading(false)
      return
    }
    const transfers = ((rawTransfers ?? []) as unknown as Transfer[]).filter((t) => {
      const d = dateCL(t.sent_at)
      return d >= reportFrom && d <= reportTo
    })

    const variantLabelById = new Map(
      variants.map((v) => [v.id, `${productNameById.get(v.product_id) ?? '—'} — ${v.calidad}${v.kilo ? ` ${formatKilo(v.kilo)}` : ''}`])
    )

    if (transfers.length === 0) {
      await generateFurgonLoadsReportPdf([], { from: reportFrom, to: reportTo, variantLabel: (id) => variantLabelById.get(id) ?? '—' })
      setReportLoading(false)
      return
    }

    const transferIds = transfers.map((t) => t.id)
    const { data: itemRows, error: itemsError } = await supabase.from('transfer_items').select('*').in('transfer_id', transferIds)
    if (itemsError) {
      setReportError(itemsError.message)
      setReportLoading(false)
      return
    }
    const itemsByTransfer = new Map<string, TransferItem[]>()
    for (const item of (itemRows ?? []) as unknown as TransferItem[]) {
      const list = itemsByTransfer.get(item.transfer_id) ?? []
      list.push(item)
      itemsByTransfer.set(item.transfer_id, list)
    }
    const loads: FurgonLoadEntry[] = transfers.map((t) => ({
      items: itemsByTransfer.get(t.id) ?? [],
    }))
    await generateFurgonLoadsReportPdf(loads, {
      from: reportFrom,
      to: reportTo,
      variantLabel: (variantId) => variantLabelById.get(variantId) ?? '—',
    })
    setReportLoading(false)
  }

  function addToCart(entry: CatalogEntry) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === entry.variantId)
      if (existing) return prev.map((i) => (i.variantId === entry.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      // Furgón-only markup: the van's default sold price starts FURGON_PRICE_MARKUP
      // above the catalog price — still editable per line afterward.
      return [
        ...prev,
        { variantId: entry.variantId, productName: entry.productName, calidad: entry.calidad, kilo: entry.kilo, price: String(entry.price + FURGON_PRICE_MARKUP), quantity: 1 },
      ]
    })
  }

  function updateCartLine(variantId: string, patch: Partial<QuickSaleLine>) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, ...patch } : i)))
  }

  function removeCartLine(variantId: string) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  const cartTotal = cart.reduce((s, i) => s + (Number(i.price) || 0) * i.quantity, 0)

  async function handleRegisterSale() {
    setSaleError(null)
    setSaleSuccess(null)
    if (cart.length === 0) {
      setSaleError('Agrega al menos un producto')
      return
    }
    if (cartTotal <= 0) {
      setSaleError('Ingresa precios válidos')
      return
    }
    if (!furgonBranchId) {
      setSaleError('No existe la sucursal del furgón todavía')
      return
    }

    // Same split-payment validation as la pantalla de Ventas: each line's
    // amount is trusted, but the lines together must add up to exactly the
    // cart total — this is what lets efectivo + tarjeta + "lo que falta" en
    // transferencia work without ever mis-registering the sale.
    const paymentsPayload = payments
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({ payment_method: p.method, amount: Number(p.amount) }))

    if (paymentsPayload.length === 0) {
      setSaleError('Registra al menos un pago')
      return
    }
    const paymentsTotal = paymentsPayload.reduce((s, p) => s + p.amount, 0)
    if (Math.round(paymentsTotal) !== Math.round(cartTotal)) {
      setSaleError(`El total de pagos (${formatCLP(paymentsTotal)}) no coincide con el total de la venta (${formatCLP(cartTotal)})`)
      return
    }

    setSaleSaving(true)
    const { error } = await supabase.rpc('create_sale', {
      p_branch_id: furgonBranchId,
      p_customer_id: null,
      p_items: cart.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, sold_price: Number(i.price) })),
      p_payments: paymentsPayload,
      p_notes: null,
      p_sale_date: todayCL(),
      p_is_terreno: true,
      p_driver_name: driverName.trim() || null,
    })
    setSaleSaving(false)
    if (error) {
      setSaleError(error.message)
      return
    }
    setCart([])
    setPayments([{ method: 'efectivo', amount: '' }])
    setSaleSuccess('Venta registrada.')
    await Promise.all([reloadInventory(), reloadSales()])
  }

  const periodSaleIds = useMemo(() => completedSales.map((s) => s.id), [completedSales])
  const saleDateById = useMemo(() => new Map(completedSales.map((s) => [s.id, s.sale_date])), [completedSales])

  const [periodItems, setPeriodItems] = useState<ItemSummary[]>([])
  const [dailySales, setDailySales] = useState<DailySalesSummary[]>([])
  const [loadingPeriodItems, setLoadingPeriodItems] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (periodSaleIds.length === 0) {
        setPeriodItems([])
        setDailySales([])
        return
      }
      setLoadingPeriodItems(true)
      const { data } = await supabase
        .from('sale_items')
        .select('sale_id, variant_id, custom_name, quantity')
        .in('sale_id', periodSaleIds)
        .eq('status', 'active')
      if (cancelled) return

      const byProduct = new Map<string, ItemSummary>()
      const fardoCountByDate = new Map<string, number>()
      for (const row of (data ?? []) as { sale_id: string; variant_id: string | null; custom_name: string | null; quantity: number }[]) {
        const variant = row.variant_id ? variants.find((v) => v.id === row.variant_id) : null
        const key = row.variant_id ?? `custom:${row.custom_name}`
        const label = variant
          ? `${productNameById.get(variant.product_id) ?? '—'} — ${variant.calidad} ${formatKilo(variant.kilo)}`
          : row.custom_name ?? '—'
        const entry = byProduct.get(key) ?? { key, label, quantity: 0 }
        entry.quantity += row.quantity
        byProduct.set(key, entry)

        const date = saleDateById.get(row.sale_id)
        if (date) fardoCountByDate.set(date, (fardoCountByDate.get(date) ?? 0) + row.quantity)
      }
      setPeriodItems(Array.from(byProduct.values()).sort((a, b) => b.quantity - a.quantity))

      // Fardo counts come from items (above); sale count and $ total come
      // straight from completedSales — no need to re-derive those from items.
      const byDate = new Map<string, DailySalesSummary>()
      for (const s of completedSales) {
        const entry = byDate.get(s.sale_date) ?? { date: s.sale_date, saleCount: 0, fardoCount: 0, total: 0 }
        entry.saleCount += 1
        entry.total += s.total
        entry.fardoCount = fardoCountByDate.get(s.sale_date) ?? 0
        byDate.set(s.sale_date, entry)
      }
      setDailySales(Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date)))
      setLoadingPeriodItems(false)
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodSaleIds.join(','), variants])

  const stockRows = useMemo(() => {
    if (!furgonBranchId) return []
    return variants
      .filter((v) => v.active)
      .map((v) => ({
        variant: v,
        productName: productNameById.get(v.product_id) ?? '—',
        stock: inventory.find((i) => i.variant_id === v.id && i.branch_id === furgonBranchId)?.quantity ?? 0,
      }))
      // stock !== 0, not > 0: a negative count (an overdraw — e.g. sold more
      // than was ever loaded) needs to stay visible to investigate, not
      // silently disappear from the board, the totals, and the PDF snapshot.
      .filter((r) => r.stock !== 0)
      .sort((a, b) => b.stock - a.stock)
  }, [variants, inventory, furgonBranchId, productNameById])

  const totalFardos = stockRows.reduce((s, r) => s + r.stock, 0)
  const totalStockValue = stockRows.reduce((s, r) => s + r.stock * r.variant.price, 0)
  const salesTotal = completedSales.reduce((s, sale) => s + sale.total, 0)
  const loading = loadingProducts || loadingInventory || loadingSales || loadingBranches

  if (!loadingBranches && !furgonBranch) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Furgón</h1>
        <p className="mt-2 text-sm text-red-600">
          No existe todavía la sucursal del furgón. Aplica la migración 0060 en Supabase y recarga esta página.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <MapPin className="text-slate-400" size={20} />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Furgón</h1>
          <p className="text-sm text-slate-500">Lo que está cargado en el furgón en este momento.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Fardos a bordo</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : totalFardos}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Valor del stock a bordo</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : formatCLP(totalStockValue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Vendido en terreno</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : `${completedSales.length} · ${formatCLP(salesTotal)}`}</p>
        </Card>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Input label="Ventas desde" type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} className="max-w-[10rem]" />
        <Input label="Ventas hasta" type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} className="max-w-[10rem]" />
        <p className="pb-2 text-xs text-slate-400">Controla la tarjeta "Vendido en terreno" y las tablas de ventas de abajo.</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {canManageStock && (
          <>
            <Button variant="secondary" onClick={() => setLoadOpen(true)} disabled={!furgonBranchId}>
              <PackagePlus size={16} />
              Cargar stock
            </Button>
            <Button variant="secondary" onClick={() => setUnloadOpen(true)} disabled={!furgonBranchId || stockRows.length === 0}>
              <PackageMinus size={16} />
              Descargar stock
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => navigate('/ventas')}>
          Pantalla completa de ventas
        </Button>
      </div>

      <Card className="mt-4 overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-sm font-medium text-slate-700">Fardos a bordo del furgón</p>
          <button
            onClick={handlePrintStockReport}
            disabled={stockReportLoading || stockRows.length === 0}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-40"
          >
            <Printer size={14} />
            {stockReportLoading ? 'Generando...' : 'Imprimir'}
          </button>
        </div>
        <table className="mt-1 w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Calidad</th>
              <th className="px-4 py-3">Kilo</th>
              <th className="px-4 py-3 text-right">Cantidad</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && stockRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  El furgón no tiene fardos cargados todavía. Usa "Cargar stock" para traer fardos desde una sucursal.
                </td>
              </tr>
            )}
            {stockRows.map((r) => (
              <tr key={r.variant.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{r.productName}</td>
                <td className="px-4 py-3 text-slate-600">{r.variant.calidad}</td>
                <td className="px-4 py-3 text-slate-600">{formatKilo(r.variant.kilo)}</td>
                <td className={`px-4 py-3 text-right ${r.stock < 0 ? 'font-medium text-red-600' : 'text-slate-900'}`}>{r.stock}</td>
                <td className="px-4 py-3 text-right text-slate-600">{formatCLP(r.stock * r.variant.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4 p-4">
        <p className="text-sm font-medium text-slate-700">Reporte de cargas al furgón</p>
        <p className="mt-0.5 text-xs text-slate-400">Descarga un PDF con todo lo cargado al furgón en el período elegido.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Input label="Desde" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="max-w-[10rem]" />
          <Input label="Hasta" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="max-w-[10rem]" />
          <Button variant="secondary" onClick={handlePrintLoadsReport} disabled={reportLoading || !furgonBranchId}>
            <Printer size={16} />
            {reportLoading ? 'Generando...' : 'Imprimir reporte'}
          </Button>
        </div>
        {reportError && <p className="mt-2 text-sm text-red-600">{reportError}</p>}
      </Card>

      {movements.length > 0 && (
        <Card className="mt-4 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Movimientos recientes</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Sucursal</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingMovements && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loadingMovements &&
                movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 text-slate-500">{formatTimeCL(m.sent_at)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={m.kind === 'load' ? 'brand' : 'gold'}>{m.kind === 'load' ? 'Carga' : 'Descarga'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{m.otherBranchName}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => reprintGuide(m.id)} className="text-slate-400 hover:text-slate-700" title="Imprimir guía">
                        <FileDown size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6 p-4">
        <p className="text-sm font-medium text-slate-700">Registrar lo vendido</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Ej: el vendedor volvió y reportó que vendió 2 Fashion Verano y 3 Ropa de Casa — agrégalos aquí y queda contabilizado
          (se marca automáticamente como "Vendido en terreno" y descuenta del stock del furgón).
        </p>

        <div className="mt-3 max-w-xs">
          <Input
            label="Vendedor del furgón"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder="Nombre de quien vende"
          />
        </div>

        <div className="mt-3">
          <ProductSearch catalog={catalog} onSelect={addToCart} branchId={furgonBranchId} />
        </div>

        {cart.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2">Cant.</th>
                  <th className="py-1 pr-2">Precio</th>
                  <th className="py-1 pr-2">Subtotal</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.map((line) => (
                  <tr key={line.variantId}>
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-slate-900">{line.productName}</span>
                      <span className="text-slate-500"> — {line.calidad} {formatKilo(line.kilo)}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateCartLine(line.variantId, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        value={line.price}
                        onChange={(e) => updateCartLine(line.variantId, { price: e.target.value })}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2 font-medium text-slate-900">{formatCLP((Number(line.price) || 0) * line.quantity)}</td>
                    <td className="py-1.5">
                      <button onClick={() => removeCartLine(line.variantId)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cart.length > 0 && (
          <div className="mt-3 max-w-sm">
            <div className="flex justify-between text-sm font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCLP(cartTotal)}</span>
            </div>
            <div className="mt-2">
              <PaymentSplit payments={payments} total={cartTotal} onChange={setPayments} />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={handleRegisterSale} disabled={saleSaving || cart.length === 0}>
            {saleSaving ? 'Registrando...' : 'Registrar venta'}
          </Button>
        </div>

        {saleError && <p className="mt-2 text-sm text-red-600">{saleError}</p>}
        {saleSuccess && <p className="mt-2 text-sm text-emerald-600">{saleSuccess}</p>}
      </Card>

      {(loadingPeriodItems || dailySales.length > 0) && (
        <Card className="mt-6 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Ventas por día</p>
          <p className="px-4 text-xs text-slate-400">Cuántos fardos se vendieron cada día y por cuánto, dentro del período elegido arriba.</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Ventas</th>
                <th className="px-4 py-3 text-right">Fardos</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingPeriodItems && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loadingPeriodItems &&
                dailySales.map((d) => (
                  <tr key={d.date}>
                    <td className="px-4 py-2.5 text-slate-900">{formatDate(`${d.date}T00:00:00`)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{d.saleCount}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{d.fardoCount}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCLP(d.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {(loadingPeriodItems || periodItems.length > 0) && (
        <Card className="mt-4 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Vendido por producto</p>
          <p className="px-4 text-xs text-slate-400">Qué fardos se vendieron, sumados en todo el período elegido arriba.</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingPeriodItems && (
                <tr>
                  <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loadingPeriodItems &&
                periodItems.map((item) => (
                  <tr key={item.key}>
                    <td className="px-4 py-2.5 text-slate-900">{item.label}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{item.quantity}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {sales.length > 0 && (
        <Card className="mt-4 overflow-x-auto">
          <p className="px-4 pt-3 text-sm font-medium text-slate-700">Ventas recientes</p>
          <p className="px-4 text-xs text-slate-400">Detalle de lo que compone "Vendido en terreno" arriba — fecha, hora y estado de cada venta.</p>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Hora</th>
                <th className="px-4 py-3">Folio</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(`${s.sale_date}T00:00:00`)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{formatTimeCL(s.created_at)}</td>
                    <td className="px-4 py-2.5 text-slate-900">{s.sale_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900">{formatCLP(s.total)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={s.status === 'completed' ? 'success' : 'danger'}>
                        {s.status === 'completed' ? 'Completada' : 'Anulada'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => openSaleDetail(s)} className="text-slate-400 hover:text-slate-700" title="Ver / editar">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {furgonBranchId && canManageStock && (
        <>
          <LoadStockModal
            open={loadOpen}
            onClose={() => setLoadOpen(false)}
            branches={otherBranches}
            defaultBranchId={effectiveBranchId}
            reloadInventory={reloadInventory}
            onDone={() => {
              reloadInventory()
              reloadMovements()
            }}
          />
          <UnloadStockModal
            open={unloadOpen}
            onClose={() => setUnloadOpen(false)}
            branches={otherBranches}
            furgonBranchId={furgonBranchId}
            defaultBranchId={effectiveBranchId}
            reloadInventory={reloadInventory}
            onDone={() => {
              reloadInventory()
              reloadMovements()
            }}
          />
        </>
      )}

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
              {detailItems.map((item) => (
                <tr key={item.id}>
                  <td className="py-1.5 pr-2">
                    {item.custom_name ?? variantLabel(item.variant_id!)}
                    {item.notes && <div className="text-[11px] italic text-slate-400">{item.notes}</div>}
                  </td>
                  <td className="py-1.5 pr-2">{item.quantity}</td>
                  <td className="py-1.5 pr-2">{formatCLP(item.sold_price)}</td>
                  <td className="py-1.5 pr-2 text-xs text-slate-500">{item.status}</td>
                  <td className="py-1.5 space-x-2">
                    {canManageStock && item.status === 'active' && detailSale?.status === 'completed' && (
                      <>
                        {item.variant_id && (
                          <button onClick={() => setExchangeTarget(item)} className="text-xs text-slate-500 underline hover:text-slate-800">
                            Cambiar
                          </button>
                        )}
                        <button onClick={() => setReturnTarget(item)} className="text-xs text-slate-500 underline hover:text-slate-800">
                          Devolver
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
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

          {detailSale?.driver_name && (
            <p className="border-t border-slate-200 pt-2 text-sm text-slate-600">Vendedor: {detailSale.driver_name}</p>
          )}

          {detailSale?.status === 'cancelled' && detailSale.cancel_reason && (
            <p className="text-sm text-red-600">Motivo de anulación: {detailSale.cancel_reason}</p>
          )}

          {canManageStock && detailSale?.status === 'completed' && (
            <div className="flex justify-end">
              <Button variant="danger" onClick={() => setCancelTarget(detailSale)}>
                Anular venta
              </Button>
            </div>
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
            await Promise.all([reloadInventory(), reloadSales()])
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
              await Promise.all([refreshSaleDetail(), reloadInventory()])
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
              await Promise.all([refreshSaleDetail(), reloadInventory()])
            }
            return result
          }}
        />
      )}
    </div>
  )
}
