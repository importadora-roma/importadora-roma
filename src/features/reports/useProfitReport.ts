import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useReports } from './useReports'

// Gross margin for a period: revenue from useReports' sales.total (already
// completed-only, branch/date filtered) minus COGS, computed here from
// sale_items.cost — the per-line cost snapshotted at sale time, which is
// itself fed by the landed-cost calculation in push_container_to_inventory
// once a container has been costed and pushed.
export function useProfitReport(branchId: string, from: string, to: string) {
  const { sales, loading: loadingSales } = useReports(branchId, from, to)
  const [cogs, setCogs] = useState(0)
  const [loadingCogs, setLoadingCogs] = useState(true)

  const reload = useCallback(async () => {
    if (sales.length === 0) {
      setCogs(0)
      setLoadingCogs(false)
      return
    }
    setLoadingCogs(true)
    const { data } = await supabase
      .from('sale_items')
      .select('cost, quantity')
      .in(
        'sale_id',
        sales.map((s) => s.id)
      )
      .eq('status', 'active')
    setCogs((data ?? []).reduce((s, i) => s + Number(i.cost) * Number(i.quantity), 0))
    setLoadingCogs(false)
  }, [sales])

  useEffect(() => {
    reload()
  }, [reload])

  const revenue = sales.reduce((s, sale) => s + sale.total, 0)

  return { revenue, cogs, grossMargin: revenue - cogs, loading: loadingSales || loadingCogs }
}
