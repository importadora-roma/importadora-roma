import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export interface Customer {
  id: string
  name: string
  rut: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  active: boolean
}

export function useCustomers() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('customers').select('*').is('deleted_at', null).order('name')
    if (error) {
      setError(error.message)
    } else {
      setCustomers((data ?? []) as unknown as Customer[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function createCustomer(input: {
    name: string
    rut: string | null
    phone: string | null
    email: string | null
    address: string | null
    notes: string | null
  }) {
    const { data, error } = await supabase.from('customers').insert(input).select().single()
    if (error) return { error: error.message, customer: null }
    await reload()
    return { error: null, customer: data as unknown as Customer }
  }

  async function updateCustomer(id: string, input: Partial<Omit<Customer, 'id'>>) {
    const { error } = await supabase.from('customers').update(input).eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function softDeleteCustomer(id: string, reason: string) {
    const { error } = await supabase
      .from('customers')
      .update({ active: false, deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { customers, loading, error, reload, createCustomer, updateCustomer, softDeleteCustomer }
}
