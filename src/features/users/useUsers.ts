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

  async function createUser(input: {
    email: string
    password: string
    full_name: string
    role: UserRole
    branch_id: string | null
    commission_pct?: number
  }) {
    const { error } = await supabase.rpc('admin_create_user', {
      p_email: input.email,
      p_password: input.password,
      p_full_name: input.full_name,
      p_role: input.role,
      p_branch_id: input.branch_id,
      p_commission_pct: input.commission_pct ?? 0,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function setUserPassword(userId: string, newPassword: string) {
    const { error } = await supabase.rpc('admin_set_user_password', { p_user_id: userId, p_new_password: newPassword })
    if (error) return { error: error.message }
    return { error: null }
  }

  return { users, loading, error, reload, updateUser, createUser, setUserPassword }
}
