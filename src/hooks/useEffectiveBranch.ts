import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useActiveBranchStore } from '@/stores/activeBranchStore'
import { useBranches } from '@/features/branches/useBranches'

// Resolves which branch the current user is operating in right now.
// Admins can switch (persisted globally via useActiveBranchStore); everyone
// else is pinned to their own branch_id, matching what RLS already enforces.
export function useEffectiveBranch() {
  const profile = useAuthStore((s) => s.profile)
  const { branches, loading } = useBranches()
  const stored = useActiveBranchStore((s) => s.branchId)
  const setStored = useActiveBranchStore((s) => s.setBranchId)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (!isAdmin || loading || branches.length === 0) return
    const stillValid = branches.some((b) => b.id === stored)
    if (!stillValid) setStored(branches[0].id)
  }, [isAdmin, loading, branches, stored, setStored])

  const branchId = isAdmin ? stored : profile?.branch_id ?? ''
  const branch = branches.find((b) => b.id === branchId) ?? null

  return { branchId, branch, setBranchId: setStored, isAdmin, branches, loading }
}
