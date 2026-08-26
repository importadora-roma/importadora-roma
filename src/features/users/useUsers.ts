import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types/models'

export function useUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('full_name')
    if (error) {
      setError(error.message)
    } else {
      setUsers((data ?? []) as unknown as Profile[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function updateUser(id: string, input: { role?: UserRole; branch_id?: string | null; active?: boolean; commission_pct?: number }) {
    const { error } = await supabase.from('users').update(input).eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { users, loading, error, reload, updateUser }
}
