import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface AppUpdate {
  id: string
  title: string
  description: string
  released_at: string
}

export function useAppUpdates() {
  const [updates, setUpdates] = useState<AppUpdate[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const userId = (await supabase.auth.getUser()).data.user?.id
    const [updatesRes, dismissalsRes] = await Promise.all([
      supabase.from('app_updates').select('id, title, description, released_at').order('released_at', { ascending: false }),
      userId
        ? supabase.from('user_update_dismissals').select('update_id').eq('user_id', userId)
        : Promise.resolve({ data: [] as { update_id: string }[] }),
    ])
    setUpdates((updatesRes.data ?? []) as unknown as AppUpdate[])
    setDismissedIds(new Set((dismissalsRes.data ?? []).map((d) => d.update_id)))
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function dismiss(updateId: string) {
    const userId = (await supabase.auth.getUser()).data.user?.id
    if (!userId) return { error: 'No autenticado' }
    setDismissedIds((prev) => new Set(prev).add(updateId))
    const { error } = await supabase.from('user_update_dismissals').insert({ user_id: userId, update_id: updateId })
    // A duplicate dismiss (23505) lands on the same end state — not a real failure.
    if (error && error.code !== '23505') {
      // Roll back the optimistic hide if the insert actually failed.
      setDismissedIds((prev) => {
        const next = new Set(prev)
        next.delete(updateId)
        return next
      })
      return { error: error.message }
    }
    return { error: null }
  }

  const visibleUpdates = updates.filter((u) => !dismissedIds.has(u.id))

  return { updates: visibleUpdates, unseenCount: visibleUpdates.length, loading, dismiss, reload }
}
