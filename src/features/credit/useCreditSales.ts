import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { PaymentMethod } from '@/types/database'

export interface CreditSaleRow {
  saleId: string
  saleNumber: string | null
  branchId: string
  customerId: string | null
  saleTotal: number
  saleStatus: string
  createdAt: string
  creditAmount: number
  paidAmount: number
  remaining: number
  dueDate: string | null
}

export interface CreditPayment {
  id: string
  sale_id: string
  amount: number
  payment_method: PaymentMethod
  notes: string | null
  created_at: string
}

export function useCreditSales(branchId: string) {
  const [rows, setRows] = useState<CreditSaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)

    const { data: creditLines, error: creditError } = await supabase
      .from('sale_payments')
      .select('sale_id, amount')
      .eq('payment_method', 'credito')

    if (creditError) {
      setError(creditError.message)
      setLoading(false)
      return
    }

    const saleIds = (creditLines ?? []).map((c) => c.sale_id as string)
    if (saleIds.length === 0) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }

    const [salesRes, paymentsRes] = await Promise.all([
      supabase.from('sales').select('id, sale_number, branch_id, customer_id, total, status, created_at, due_date').in('id', saleIds),
      supabase.from('sale_credit_payments').select('sale_id, amount').in('sale_id', saleIds),
    ])

    if (salesRes.error) {
      setError(salesRes.error.message)
      setLoading(false)
      return
    }

    const creditBySale = new Map<string, number>()
    for (const line of creditLines ?? []) {
      creditBySale.set(line.sale_id as string, (creditBySale.get(line.sale_id as string) ?? 0) + Number(line.amount))
    }

    const paidBySale = new Map<string, number>()
    for (const p of paymentsRes.data ?? []) {
      paidBySale.set(p.sale_id as string, (paidBySale.get(p.sale_id as string) ?? 0) + Number(p.amount))
    }

    const built: CreditSaleRow[] = (salesRes.data ?? [])
      .filter((s) => !branchId || s.branch_id === branchId)
      .map((s) => {
        const creditAmount = creditBySale.get(s.id as string) ?? 0
        const paidAmount = paidBySale.get(s.id as string) ?? 0
        return {
          saleId: s.id as string,
          saleNumber: s.sale_number as string | null,
          branchId: s.branch_id as string,
          customerId: s.customer_id as string | null,
          saleTotal: Number(s.total),
          saleStatus: s.status as string,
          createdAt: s.created_at as string,
          creditAmount,
          paidAmount,
          remaining: creditAmount - paidAmount,
          dueDate: (s.due_date as string | null) ?? null,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    setRows(built)
    setError(null)
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  const pending = useMemo(() => rows.filter((r) => r.remaining > 0 && r.saleStatus === 'completed'), [rows])
  const totalOutstanding = useMemo(() => pending.reduce((s, r) => s + r.remaining, 0), [pending])

  async function loadPayments(saleId: string) {
    const { data, error } = await supabase
      .from('sale_credit_payments')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false })
    return { payments: (data ?? []) as unknown as CreditPayment[], error: error?.message ?? null }
  }

  async function recordPayment(saleId: string, amount: number, paymentMethod: PaymentMethod, notes: string) {
    const { error } = await supabase.rpc('record_credit_payment', {
      p_sale_id: saleId,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function updateDueDate(saleId: string, dueDate: string | null) {
    const { error } = await supabase.from('sales').update({ due_date: dueDate }).eq('id', saleId)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { rows, pending, totalOutstanding, loading, error, reload, loadPayments, recordPayment, updateDueDate }
}
