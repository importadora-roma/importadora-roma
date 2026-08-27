import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TransferStatus } from '@/types/database'

export interface Transfer {
  id: string
  transfer_number: string | null
  origin_branch_id: string
  destination_branch_id: string
  status: TransferStatus
  sent_by: string
  sent_at: string
  received_by: string | null
  received_at: string | null
  notes: string | null
}

export interface TransferItem {
  id: string
  transfer_id: string
  variant_id: string
  quantity: number
  unit_price: number | null
}

export function useTransfers() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('transfers').select('*').order('sent_at', { ascending: false }).limit(200)
    if (error) {
      setError(error.message)
    } else {
      setTransfers((data ?? []) as unknown as Transfer[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function loadTransferItems(transferId: string) {
    const { data, error } = await supabase.from('transfer_items').select('*').eq('transfer_id', transferId)
    return { items: (data ?? []) as unknown as TransferItem[], error: error?.message ?? null }
  }

  async function createTransfer(
    originBranchId: string,
    destinationBranchId: string,
    items: { variant_id: string; quantity: number; unit_price?: number | null }[],
    notes: string | null
  ) {
    const { data, error } = await supabase.rpc('create_transfer', {
      p_origin_branch_id: originBranchId,
      p_destination_branch_id: destinationBranchId,
      p_items: items,
      p_notes: notes,
    })
    if (error) return { error: error.message, transferId: null }
    await reload()
    return { error: null, transferId: data as string }
  }

  async function receiveTransfer(transferId: string) {
    const { error } = await supabase.rpc('receive_transfer', { p_transfer_id: transferId })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { transfers, loading, error, reload, loadTransferItems, createTransfer, receiveTransfer }
}
