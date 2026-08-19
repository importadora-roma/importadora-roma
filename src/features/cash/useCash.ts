import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface CashRegister {
  id: string
  branch_id: string
  opened_by: string
  opened_at: string
  opening_amount: number
  closed_by: string | null
  closed_at: string | null
  expected_amount: number | null
  actual_amount: number | null
  difference: number | null
  status: 'open' | 'closed'
  notes: string | null
}

export interface CashMovement {
  id: string
  cash_register_id: string
  branch_id: string
  movement_type: 'sale_payment' | 'sale_cancel_refund' | 'manual_in' | 'manual_out'
  category: string | null
  amount: number
  reference_type: string | null
  reference_id: string | null
  description: string | null
  created_by: string | null
  created_at: string
}

export function useCash(branchId: string) {
  const [register, setRegister] = useState<CashRegister | null>(null)
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!branchId) {
      setRegister(null)
      setMovements([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data: registerData, error: registerError } = await supabase
      .from('cash_registers')
      .select('*')
      .eq('branch_id', branchId)
      .eq('status', 'open')
      .maybeSingle()

    if (registerError) {
      setError(registerError.message)
      setLoading(false)
      return
    }

    const reg = registerData as unknown as CashRegister | null
    setRegister(reg)

    if (reg) {
      const { data: movementsData, error: movementsError } = await supabase
        .from('cash_movements')
        .select('*')
        .eq('cash_register_id', reg.id)
        .order('created_at', { ascending: false })
      if (movementsError) {
        setError(movementsError.message)
      } else {
        setMovements((movementsData ?? []) as unknown as CashMovement[])
        setError(null)
      }
    } else {
      setMovements([])
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function openRegister(openingAmount: number) {
    const { error } = await supabase.rpc('open_cash_register', { p_branch_id: branchId, p_opening_amount: openingAmount })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function closeRegister(actualAmount: number) {
    if (!register) return { error: 'No hay caja abierta' }
    const { error } = await supabase.rpc('close_cash_register', {
      p_cash_register_id: register.id,
      p_actual_amount: actualAmount,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function addManualMovement(type: 'manual_in' | 'manual_out', category: string, amount: number, description: string) {
    if (!register) return { error: 'No hay caja abierta' }
    const { error } = await supabase.rpc('add_manual_cash_movement', {
      p_cash_register_id: register.id,
      p_movement_type: type,
      p_category: category,
      p_amount: amount,
      p_description: description || null,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  const expectedNow = register ? register.opening_amount + movements.reduce((sum, m) => sum + m.amount, 0) : 0

  return { register, movements, loading, error, expectedNow, reload, openRegister, closeRegister, addManualMovement }
}
