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
  created_at: string
}

export function useExpenses(branchId: string, dateFrom: string, dateTo: string) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!branchId) {
      setExpenses([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
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
  }) {
    const { error } = await supabase.from('expenses').insert({ ...input, branch_id: branchId })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function deleteExpense(id: string, reason: string) {
    const { error } = await supabase
      .from('expenses')
      .update({ deleted_at: new Date().toISOString(), delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return { expenses, total, loading, error, reload, createExpense, deleteExpense }
}
