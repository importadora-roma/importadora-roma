import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type ApprovalRequestType = 'price_change' | 'product_delete' | 'cash_adjustment'

export interface ApprovalRequest {
  id: string
  request_type: ApprovalRequestType
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string
  branch_id: string | null
  description: string
  payload: Record<string, unknown>
  created_at: string
  requesterName: string | null
  branchName: string | null
}

export async function createApprovalRequest(requestType: ApprovalRequestType, description: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc('create_approval_request', {
    p_request_type: requestType,
    p_description: description,
    p_payload: payload,
  })
  return { error: error?.message ?? null }
}

export function usePendingApprovals() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const rows = data ?? []
    const userIds = [...new Set(rows.map((r) => r.requested_by as string))]
    const branchIds = [...new Set(rows.map((r) => r.branch_id as string | null).filter((id): id is string => !!id))]

    const [usersRes, branchesRes] = await Promise.all([
      userIds.length
        ? supabase.from('users').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      branchIds.length
        ? supabase.from('branches').select('id, name').in('id', branchIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])

    const nameByUser = new Map((usersRes.data ?? []).map((u) => [u.id as string, u.full_name as string]))
    const nameByBranch = new Map((branchesRes.data ?? []).map((b) => [b.id as string, b.name as string]))

    setRequests(
      rows.map((r) => {
        const branchId = (r.branch_id as string | null) ?? null
        return {
          id: r.id as string,
          request_type: r.request_type as ApprovalRequestType,
          status: r.status as 'pending' | 'approved' | 'rejected',
          requested_by: r.requested_by as string,
          branch_id: branchId,
          description: r.description as string,
          payload: (r.payload as Record<string, unknown>) ?? {},
          created_at: r.created_at as string,
          requesterName: nameByUser.get(r.requested_by as string) ?? null,
          branchName: branchId ? nameByBranch.get(branchId) ?? null : null,
        }
      })
    )
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function approve(id: string) {
    const { error } = await supabase.rpc('approve_approval_request', { p_request_id: id })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function reject(id: string, note?: string) {
    const { error } = await supabase.rpc('reject_approval_request', { p_request_id: id, p_note: note || null })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { requests, loading, error, reload, approve, reject }
}
