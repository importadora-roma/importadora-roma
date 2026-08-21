import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { UnknownCode } from './types'

export interface UnknownCodeWithContainer extends UnknownCode {
  container_internal_number: string | null
  container_code: string
}

interface JoinedRow extends UnknownCode {
  containers: { internal_number: string | null; code: string; deleted_at: string | null }
}

// Cross-container triage list ("Códigos Desconocidos" nav item) — every
// unresolved unknown code across every non-deleted container in the branch,
// newest first.
export function useUnknownCodesForBranch(branchId: string) {
  const [items, setItems] = useState<UnknownCodeWithContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('container_unknown_codes')
      .select('*, containers!inner(internal_number, code, branch_id, deleted_at)')
      .in('status', ['pending', 'review_later'])
      .order('created_at', { ascending: false })
    if (branchId) query = query.eq('containers.branch_id', branchId)

    const { data, error } = await query
    if (error) {
      setError(error.message)
    } else {
      setItems(
        ((data ?? []) as unknown as JoinedRow[])
          .filter((row) => !row.containers.deleted_at)
          .map((row) => ({
            ...row,
            container_internal_number: row.containers.internal_number,
            container_code: row.containers.code,
          }))
      )
      setError(null)
    }
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  return { items, loading, error, reload }
}

export async function resolveUnknownCode(
  containerId: string,
  codeNormalized: string,
  action: 'add_to_list' | 'manual_match' | 'ignore' | 'review_later',
  payload: { productName?: string; calidad?: string; expectedQty?: number; matchedItemId?: string; notes?: string }
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('resolve_unknown_code', {
    p_container_id: containerId,
    p_code_normalized: codeNormalized,
    p_action: action,
    p_product_name: payload.productName ?? null,
    p_calidad: payload.calidad ?? null,
    p_expected_qty: payload.expectedQty ?? null,
    p_matched_item_id: payload.matchedItemId ?? null,
    p_notes: payload.notes ?? null,
  })
  return { error: error?.message ?? null }
}
