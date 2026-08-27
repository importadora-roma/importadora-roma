import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useProducts } from '@/features/products/useProducts'
import { useReports } from './useReports'

export interface ProductProfitRow {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  quantity: number
  revenue: number
  cost: number
  margin: number
  marginPct: number
}

// Per-product breakdown of the same revenue/COGS data useProfitReport
// aggregates — grouped by variant so it doubles as a best-sellers /
// worst-margin report for the selected branch and period.
export function useProductProfitReport(branchId: string, from: string, to: string) {
  const { sales, loading: loadingSales } = useReports(branchId, from, to)
  const { products, variants } = useProducts()
  const [rows, setRows] = useState<ProductProfitRow[]>([])
  const [loadingItems, setLoadingItems] = useState(true)

  const reload = useCallback(async () => {
    if (sales.length === 0) {
      setRows([])
      setLoadingItems(false)
      return
    }
    setLoadingItems(true)
    const { data } = await supabase
      .from('sale_items')
      .select('variant_id, quantity, line_total, cost')
      .in(
        'sale_id',
        sales.map((s) => s.id)
      )
      .eq('status', 'active')

    const productById = new Map(products.map((p) => [p.id, p]))
    const variantById = new Map(variants.map((v) => [v.id, v]))

    const byVariant = new Map<string, { quantity: number; revenue: number; cost: number }>()
    for (const item of data ?? []) {
      const variantId = item.variant_id as string
      const entry = byVariant.get(variantId) ?? { quantity: 0, revenue: 0, cost: 0 }
      entry.quantity += Number(item.quantity)
      entry.revenue += Number(item.line_total)
      entry.cost += Number(item.cost) * Number(item.quantity)
      byVariant.set(variantId, entry)
    }

    const built: ProductProfitRow[] = Array.from(byVariant.entries()).map(([variantId, agg]) => {
      const variant = variantById.get(variantId)
      const product = variant ? productById.get(variant.product_id) : undefined
      const margin = agg.revenue - agg.cost
      return {
        variantId,
        productName: product?.name ?? 'Producto eliminado',
        calidad: variant?.calidad ?? '—',
        kilo: variant?.kilo ?? 0,
        quantity: agg.quantity,
        revenue: agg.revenue,
        cost: agg.cost,
        margin,
        marginPct: agg.revenue > 0 ? (margin / agg.revenue) * 100 : 0,
      }
    })

    built.sort((a, b) => b.revenue - a.revenue)
    setRows(built)
    setLoadingItems(false)
  }, [sales, products, variants])

  useEffect(() => {
    reload()
  }, [reload])

  return { rows, loading: loadingSales || loadingItems, reload }
}
