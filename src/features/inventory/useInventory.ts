import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { InventoryRow } from '@/types/models'

export function useInventory() {
  const [inventory, setInventory] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('inventory').select('*')
    if (error) {
      setError(error.message)
    } else {
      setInventory((data ?? []) as unknown as InventoryRow[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function adjustInventory(variantId: string, branchId: string, newQuantity: number, reason: string) {
    const { error } = await supabase.rpc('adjust_inventory', {
      p_variant_id: variantId,
      p_branch_id: branchId,
      p_new_quantity: newQuantity,
      p_reason: reason,
    })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function clearBranchInventory(branchId: string, reason: string) {
    const { data, error } = await supabase.rpc('clear_branch_inventory', { p_branch_id: branchId, p_reason: reason })
    if (error) return { itemsCleared: 0, error: error.message }
    await reload()
    return { itemsCleared: (data as unknown as { itemsCleared: number })?.itemsCleared ?? 0, error: null }
  }

  return { inventory, loading, error, reload, adjustInventory, clearBranchInventory }
}
