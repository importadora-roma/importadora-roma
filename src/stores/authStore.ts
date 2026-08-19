import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/models'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).single()
  if (error) {
    console.error('Error al cargar el perfil de usuario:', error.message)
    return null
  }
  return data as unknown as Profile
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,

  initialize: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const profile = session ? await fetchProfile(session.user.id) : null
    set({ session, profile, loading: false })

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      const newProfile = newSession ? await fetchProfile(newSession.user.id) : null
      set({ session: newSession, profile: newProfile })
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null })
  },
}))
