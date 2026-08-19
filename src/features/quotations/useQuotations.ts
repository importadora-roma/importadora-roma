import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { QuotationStatus, SalePaymentMethod } from '@/types/database'

export interface Quotation {
  id: string
  quotation_number: string | null
  branch_id: string
  customer_id: string | null
  user_id: string
  status: QuotationStatus
  subtotal: number
  total: number
  valid_until: string | null
  converted_sale_id: string | null
  notes: string | null
  created_at: string
}

export interface QuotationItem {
  id: string
  quotation_id: string
  variant_id: string
  quantity: number
  unit_price: number
  line_total: number
}

export function useQuotations(branchId: string) {
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('quotations').select('*').order('created_at', { ascending: false }).limit(200)
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setQuotations((data ?? []) as unknown as Quotation[])
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function loadQuotationItems(quotationId: string) {
    const { data, error } = await supabase.from('quotation_items').select('*').eq('quotation_id', quotationId)
    return { items: (data ?? []) as unknown as QuotationItem[], error: error?.message ?? null }
  }

  async function createQuotation(input: {
    branch_id: string
    customer_id: string | null
    valid_until: string | null
    notes: string | null
    items: { variant_id: string; quantity: number; unit_price: number }[]
  }) {
    const subtotal = input.items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
    const { data: quotation, error: quotationError } = await supabase
      .from('quotations')
      .insert({
        branch_id: input.branch_id,
        customer_id: input.customer_id,
        valid_until: input.valid_until,
        notes: input.notes,
        subtotal,
        total: subtotal,
        user_id: (await supabase.auth.getUser()).data.user?.id ?? '',
      })
      .select()
      .single()

    if (quotationError || !quotation) return { error: quotationError?.message ?? 'Error al crear cotización' }

    const q = quotation as unknown as Quotation
    const itemsPayload = input.items.map((i) => ({
      quotation_id: q.id,
      variant_id: i.variant_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      line_total: i.unit_price * i.quantity,
    }))
    const { error: itemsError } = await supabase.from('quotation_items').insert(itemsPayload)
    if (itemsError) return { error: itemsError.message }

    await reload()
    return { error: null, quotation: q }
  }

  async function convertToSale(quotationId: string, payments: { payment_method: SalePaymentMethod; amount: number }[]) {
    const { data, error } = await supabase.rpc('convert_quotation_to_sale', {
      p_quotation_id: quotationId,
      p_payments: payments,
    })
    if (error) return { error: error.message, saleId: null }
    await reload()
    return { error: null, saleId: data as string }
  }

  async function cancelQuotation(quotationId: string) {
    const { error } = await supabase.from('quotations').update({ status: 'cancelled' }).eq('id', quotationId)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { quotations, loading, error, reload, loadQuotationItems, createQuotation, convertToSale, cancelQuotation }
}
