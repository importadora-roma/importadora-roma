import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Value of fardos sent out to other branches in a period — kept separate
// from useReports' sales totals since a transfer isn't a sale, just stock
// moving from one of our own branches to another.
export function useTransferValue(originBranchId: string, from: string, to: string) {
  const [total, setTotal] = useState(0)
  const [transferCount, setTransferCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transfers')
      .select('id')
      .gte('sent_at', `${from}T00:00:00`)
      .lte('sent_at', `${to}T23:59:59`)
    if (originBranchId) query = query.eq('origin_branch_id', originBranchId)
    const { data: transfers, error: transfersError } = await query
    if (transfersError) {
      setError(transfersError.message)
      setLoading(false)
      return
    }
    const transferIds = (transfers ?? []).map((t) => t.id)
    setTransferCount(transferIds.length)
    if (transferIds.length === 0) {
      setTotal(0)
      setError(null)
      setLoading(false)
      return
    }
    const { data: items, error: itemsError } = await supabase
      .from('transfer_items')
      .select('quantity, unit_price')
      .in('transfer_id', transferIds)
    if (itemsError) {
      setError(itemsError.message)
    } else {
      setTotal((items ?? []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price ?? 0), 0))
      setError(null)
    }
    setLoading(false)
  }, [originBranchId, from, to])

  useEffect(() => {
    reload()
  }, [reload])

  return { total, transferCount, loading, error, reload }
}
