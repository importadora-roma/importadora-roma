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
  // The Furgón branch is managed entirely through its own tab (loading,
  // selling, etc. all go through dedicated flows there) — it was never
  // meant to be picked as "the branch I'm operating in" for Ventas/Caja/
  // Créditos/etc., so it's excluded from the switcher and from the
  // auto-pick-a-default-branch fallback below.
  const selectableBranches = branches.filter((b) => !b.is_furgon)

  useEffect(() => {
    if (!isAdmin || loading || selectableBranches.length === 0) return
    const stillValid = selectableBranches.some((b) => b.id === stored)
    if (!stillValid) setStored(selectableBranches[0].id)
  }, [isAdmin, loading, selectableBranches, stored, setStored])

  const branchId = isAdmin ? stored : profile?.branch_id ?? ''
  const branch = branches.find((b) => b.id === branchId) ?? null

  return { branchId, branch, setBranchId: setStored, isAdmin, branches: selectableBranches, loading }
}
