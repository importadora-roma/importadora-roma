import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { PaymentMethod } from '@/types/database'

export interface ReportSale {
  id: string
  sale_number: string | null
  branch_id: string
  total: number
  created_at: string
}

export interface ReportPayment {
  sale_id: string
  payment_method: PaymentMethod
  amount: number
}

export function useReports(branchId: string, from: string, to: string) {
  const [sales, setSales] = useState<ReportSale[]>([])
  const [payments, setPayments] = useState<ReportPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('sales')
      .select('id, sale_number, branch_id, total, created_at')
      .eq('status', 'completed')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at')

    if (branchId) query = query.eq('branch_id', branchId)

    const { data: salesData, error: salesError } = await query
    if (salesError) {
      setError(salesError.message)
      setLoading(false)
      return
    }

    const saleRows = (salesData ?? []) as unknown as ReportSale[]
    setSales(saleRows)

    if (saleRows.length === 0) {
      setPayments([])
      setError(null)
      setLoading(false)
      return
    }

    const { data: paymentsData, error: paymentsError } = await supabase
      .from('sale_payments')
      .select('sale_id, payment_method, amount')
      .in('sale_id', saleRows.map((s) => s.id))

    if (paymentsError) {
      setError(paymentsError.message)
    } else {
      setPayments((paymentsData ?? []) as unknown as ReportPayment[])
      setError(null)
    }
    setLoading(false)
  }, [branchId, from, to])

  useEffect(() => {
    reload()
  }, [reload])

  return { sales, payments, loading, error, reload }
}
