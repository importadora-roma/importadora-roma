import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dateCL } from '@/lib/format'

// Pure calendar-date arithmetic (not anchored to "today"), same approach as
// addDaysCL in lib/format.ts: shifts a Y-M-D string by N days via Date.UTC
// so it's unaffected by DST or the viewing device's own timezone.
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

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
    // sent_at is a real UTC instant, but `from`/`to` are Chile-local
    // calendar dates (from todayCL() or a date picker) — comparing them
    // directly as if `${from}T00:00:00` were Chile midnight was actually
    // asking Postgres for UTC midnight, which is 3-4 hours into the Chile
    // day. That silently dropped transfers sent early in the Chile day
    // and pulled in ones sent late the previous Chile evening. Fetch a
    // day of slack on each side in UTC, then filter precisely by each
    // transfer's actual Chile-local date.
    let query = supabase
      .from('transfers')
      .select('id, sent_at')
      .gte('sent_at', `${shiftDate(from, -1)}T00:00:00Z`)
      .lte('sent_at', `${shiftDate(to, 1)}T23:59:59Z`)
    if (originBranchId) query = query.eq('origin_branch_id', originBranchId)
    const { data: rawTransfers, error: transfersError } = await query
    if (transfersError) {
      setError(transfersError.message)
      setLoading(false)
      return
    }
    const transfers = (rawTransfers ?? []).filter((t) => {
      const d = dateCL(t.sent_at)
      return d >= from && d <= to
    })
    const transferIds = transfers.map((t) => t.id)
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
