import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const LOOKBACK_DAYS = 90
const TOP_N = 30

interface SaleItemJoinRow {
  variant_id: string
  quantity: number
}

// Ranks variants by units sold in this branch over the last LOOKBACK_DAYS —
// powers the product search's default ("what to show before the user types
// anything") view so it surfaces the fardos staff actually move, not an
// arbitrary slice of the catalog.
export function useTopSellingVariantIds(branchId: string) {
  const [topVariantIds, setTopVariantIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!branchId) {
        setTopVariantIds([])
        setLoading(false)
        return
      }
      setLoading(true)
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('sale_items')
        .select('variant_id, quantity, sales!inner(branch_id, sale_date)')
        .eq('status', 'active')
        .eq('sales.branch_id', branchId)
        .gte('sales.sale_date', cutoff)
      if (cancelled) return
      if (error || !data) {
        setTopVariantIds([])
        setLoading(false)
        return
      }
      const totals = new Map<string, number>()
      for (const row of data as unknown as SaleItemJoinRow[]) {
        totals.set(row.variant_id, (totals.get(row.variant_id) ?? 0) + Number(row.quantity))
      }
      const ranked = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N)
        .map(([variantId]) => variantId)
      setTopVariantIds(ranked)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [branchId])

  return { topVariantIds, loading }
}
