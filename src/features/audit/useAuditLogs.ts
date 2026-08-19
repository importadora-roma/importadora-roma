import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface AuditLog {
  id: string
  user_id: string | null
  action: string
  table_name: string | null
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

const PAGE_SIZE = 100

export function useAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (offset: number, replace: boolean) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      setError(error.message)
    } else {
      const rows = (data ?? []) as unknown as AuditLog[]
      setLogs((prev) => (replace ? rows : [...prev, ...rows]))
      setHasMore(rows.length === PAGE_SIZE)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load(0, true)
  }, [load])

  function loadMore() {
    load(logs.length, false)
  }

  return { logs, loading, hasMore, error, loadMore }
}
