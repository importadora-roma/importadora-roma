import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { InvoiceStatus } from '@/types/database'
import type { SaleItem } from '@/features/sales/useSales'

export interface InvoiceQueueRow {
  invoice_id: string
  internal_number: string | null
  sale_id: string
  branch_id: string
  status: InvoiceStatus
  sii_folio: string | null
  notes: string | null
  issued_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  sale_number: string | null
  gross_total: number
  net_total: number
  iva_total: number
  customer_id: string | null
  customer_name: string | null
  customer_rut: string | null
}

// Backed by invoice_queue (supabase/migrations/0014_invoices.sql), which
// computes net/IVA/gross live from sales.total — never stored/snapshotted,
// so it can't go stale if the underlying sale is later modified.
export function useInvoices(branchId: string) {
  const [invoices, setInvoices] = useState<InvoiceQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('invoice_queue').select('*').order('created_at', { ascending: false }).limit(300)
    if (branchId) query = query.eq('branch_id', branchId)
    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setInvoices((data ?? []) as unknown as InvoiceQueueRow[])
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function issueInvoice(invoiceId: string, siiFolio: string) {
    const { error } = await supabase.rpc('issue_invoice', { p_invoice_id: invoiceId, p_sii_folio: siiFolio.trim() || null })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function cancelInvoice(invoiceId: string, reason: string) {
    const { error } = await supabase.rpc('cancel_invoice', { p_invoice_id: invoiceId, p_reason: reason })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { invoices, loading, error, reload, issueInvoice, cancelInvoice }
}

export async function loadInvoiceLines(saleId: string): Promise<{ items: SaleItem[]; error: string | null }> {
  const { data, error } = await supabase.from('sale_items').select('*').eq('sale_id', saleId).eq('status', 'active')
  return { items: (data ?? []) as unknown as SaleItem[], error: error?.message ?? null }
}
