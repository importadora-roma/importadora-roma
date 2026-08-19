import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Branch } from '@/types/models'

interface BranchesState {
  branches: Branch[]
  loading: boolean
  error: string | null
  fetched: boolean
  reload: () => Promise<void>
  createBranch: (input: { name: string; address: string | null; phone: string | null; branch_type: Branch['branch_type'] }) => Promise<{ error: string | null }>
  updateBranch: (
    id: string,
    input: Partial<Pick<Branch, 'name' | 'address' | 'phone' | 'branch_type' | 'active'>>
  ) => Promise<{ error: string | null }>
  softDeleteBranch: (id: string, reason: string) => Promise<{ error: string | null }>
}

export const useBranchesStore = create<BranchesState>((set, get) => ({
  branches: [],
  loading: false,
  error: null,
  fetched: false,

  reload: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('branches').select('*').is('deleted_at', null).order('name')
    if (error) {
      set({ error: error.message, loading: false, fetched: true })
    } else {
      set({ branches: (data ?? []) as unknown as Branch[], error: null, loading: false, fetched: true })
    }
  },

  createBranch: async (input) => {
    const { error } = await supabase.from('branches').insert(input)
    if (error) return { error: error.message }
    await get().reload()
    return { error: null }
  },

  updateBranch: async (id, input) => {
    const { error } = await supabase.from('branches').update(input).eq('id', id)
    if (error) return { error: error.message }
    await get().reload()
    return { error: null }
  },

  softDeleteBranch: async (id, reason) => {
    const userId = useAuthStore.getState().session?.user.id
    const { error } = await supabase
      .from('branches')
      .update({ active: false, deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await get().reload()
    return { error: null }
  },
}))
