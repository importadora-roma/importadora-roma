import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { InventoryMovementType } from '@/types/database'

export interface KardexEntry {
  id: string
  variant_id: string
  branch_id: string
  movement_type: InventoryMovementType
  quantity: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

const PAGE_SIZE = 100

export function useKardex(branchId: string) {
  const [entries, setEntries] = useState<KardexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true)
      let query = supabase
        .from('inventory_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      if (branchId) query = query.eq('branch_id', branchId)

      const { data, error } = await query
      if (error) {
        setError(error.message)
      } else {
        const rows = (data ?? []) as unknown as KardexEntry[]
        setEntries((prev) => (replace ? rows : [...prev, ...rows]))
        setHasMore(rows.length === PAGE_SIZE)
        setError(null)
      }
      setLoading(false)
    },
    [branchId]
  )

  useEffect(() => {
    load(0, true)
  }, [load])

  function loadMore() {
    load(entries.length, false)
  }

  return { entries, loading, hasMore, error, loadMore }
}
