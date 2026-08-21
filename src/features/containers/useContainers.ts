import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Container } from './types'

export function useContainers(branchId: string) {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [containers, setContainers] = useState<Container[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('containers')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setContainers((data ?? []) as unknown as Container[])
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function createContainer(input: {
    code: string
    branch_id: string
    supplier: string | null
    arrival_date: string | null
    notes: string | null
  }) {
    const { data, error } = await supabase
      .from('containers')
      .insert({ ...input, created_by: userId })
      .select()
      .single()
    if (error) return { container: null, error: error.message }
    await reload()
    return { container: data as unknown as Container, error: null }
  }

  async function updateContainerMeta(
    id: string,
    input: Partial<Pick<Container, 'code' | 'supplier' | 'arrival_date' | 'notes'>>
  ) {
    const { error } = await supabase.from('containers').update(input).eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function softDeleteContainer(id: string, reason: string) {
    const { error } = await supabase
      .from('containers')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { containers, loading, error, reload, createContainer, updateContainerMeta, softDeleteContainer }
}
