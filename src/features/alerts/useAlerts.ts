import { useMemo } from 'react'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'
import { useCreditSales } from '@/features/credit/useCreditSales'
import { useInvoices } from '@/features/invoices/useInvoices'
import { useAlertSettings } from './useAlertSettings'

export interface LowStockAlert {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  quantity: number
}

export interface OverdueCreditAlert {
  saleId: string
  saleNumber: string | null
  customerId: string | null
  remaining: number
  dueDate: string
  daysOverdue: number
}

// Aggregates the "needs attention right now" signals already computed
// elsewhere in the app (inventory, credit, invoices) into one bell — no
// stored notification/read-state table, this always reflects live state.
export function useAlerts(branchId: string, includeFinancial: boolean) {
  const { settings } = useAlertSettings()
  const { products, variants } = useProducts()
  const { inventory } = useInventory()
  const { pending: creditPending } = useCreditSales(includeFinancial ? branchId : '')
  const { invoices } = useInvoices(includeFinancial ? branchId : '')

  const lowStock = useMemo<LowStockAlert[]>(() => {
    if (!branchId) return []
    const productById = new Map(products.map((p) => [p.id, p]))
    const variantById = new Map(variants.filter((v) => v.active).map((v) => [v.id, v]))
    return inventory
      .filter((i) => i.branch_id === branchId && variantById.has(i.variant_id) && i.quantity <= settings.low_stock_threshold)
      .map((i) => {
        const variant = variantById.get(i.variant_id)!
        const product = productById.get(variant.product_id)
        return {
          variantId: variant.id,
          productName: product?.name ?? 'Producto',
          calidad: variant.calidad,
          kilo: variant.kilo,
          quantity: i.quantity,
        }
      })
      .sort((a, b) => a.quantity - b.quantity)
  }, [branchId, inventory, products, variants, settings.low_stock_threshold])

  const overdueCredit = useMemo<OverdueCreditAlert[]>(() => {
    if (!includeFinancial) return []
    const today = new Date().toISOString().slice(0, 10)
    return creditPending
      .filter((r): r is typeof r & { dueDate: string } => !!r.dueDate && r.dueDate < today)
      .map((r) => ({
        saleId: r.saleId,
        saleNumber: r.saleNumber,
        customerId: r.customerId,
        remaining: r.remaining,
        dueDate: r.dueDate,
        daysOverdue: Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86400000),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
  }, [creditPending, includeFinancial])

  const pendingInvoices = useMemo(
    () => (includeFinancial ? invoices.filter((i) => i.status === 'pending') : []),
    [invoices, includeFinancial]
  )

  const totalCount = lowStock.length + overdueCredit.length + pendingInvoices.length

  return { lowStock, overdueCredit, pendingInvoices, totalCount }
}
