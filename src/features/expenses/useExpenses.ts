import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ExpenseCategory } from '@/types/database'

export interface Expense {
  id: string
  branch_id: string
  category: ExpenseCategory
  description: string
  amount: number
  expense_date: string
  notes: string | null
  paid_from_cash: boolean
  created_at: string
}

export function useExpenses(branchId: string, dateFrom: string, dateTo: string) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('expenses')
      .select('*')
      .is('deleted_at', null)
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setExpenses((data ?? []) as unknown as Expense[])
      setError(null)
    }
    setLoading(false)
  }, [branchId, dateFrom, dateTo])

  useEffect(() => {
    reload()
  }, [reload])

  async function createExpense(input: {
    category: ExpenseCategory
    description: string
    amount: number
    expense_date: string
    notes: string | null
    paid_from_cash?: boolean
  }) {
    const { data, error } = await supabase.rpc('create_expense', {
      p_branch_id: branchId,
      p_category: input.category,
      p_description: input.description,
      p_amount: input.amount,
      p_expense_date: input.expense_date,
      p_notes: input.notes,
      p_paid_from_cash: input.paid_from_cash ?? false,
    })
    if (error) return { error: error.message, registerAdjusted: false }
    await reload()
    const result = data as unknown as { id: string; registerAdjusted: boolean }
    return { error: null, registerAdjusted: result?.registerAdjusted ?? false }
  }

  async function deleteExpense(id: string, reason: string) {
    const { error } = await supabase.rpc('delete_expense', { p_expense_id: id, p_reason: reason })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return { expenses, total, loading, error, reload, createExpense, deleteExpense }
}
