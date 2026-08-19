import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { SaleItemStatus, SaleStatus, PaymentMethod } from '@/types/database'

export interface Sale {
  id: string
  sale_number: string | null
  branch_id: string
  customer_id: string | null
  user_id: string
  status: SaleStatus
  subtotal: number
  total: number
  cancel_reason: string | null
  notes: string | null
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  variant_id: string
  quantity: number
  original_price: number
  sold_price: number
  cost: number
  line_total: number
  status: SaleItemStatus
  return_reason: string | null
}

export interface SalePayment {
  id: string
  sale_id: string
  payment_method: PaymentMethod
  amount: number
}

export function useSales(branchId: string) {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(200)
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setSales((data ?? []) as unknown as Sale[])
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function loadSaleDetail(saleId: string) {
    const [itemsRes, paymentsRes] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', saleId),
      supabase.from('sale_payments').select('*').eq('sale_id', saleId),
    ])
    return {
      items: (itemsRes.data ?? []) as unknown as SaleItem[],
      payments: (paymentsRes.data ?? []) as unknown as SalePayment[],
      error: itemsRes.error?.message ?? paymentsRes.error?.message ?? null,
    }
  }

  async function cancelSale(saleId: string, reason: string) {
    const { error } = await supabase.rpc('cancel_sale', { p_sale_id: saleId, p_reason: reason })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function exchangeSaleItem(
    saleItemId: string,
    newVariantId: string,
    newQuantity: number,
    reason: string,
    additionalPayments: { payment_method: PaymentMethod; amount: number }[]
  ) {
    const { error } = await supabase.rpc('exchange_sale_item', {
      p_sale_item_id: saleItemId,
      p_new_variant_id: newVariantId,
      p_new_quantity: newQuantity,
      p_reason: reason,
      p_additional_payments: additionalPayments.length > 0 ? additionalPayments : null,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { sales, loading, error, reload, loadSaleDetail, cancelSale, exchangeSaleItem }
}
