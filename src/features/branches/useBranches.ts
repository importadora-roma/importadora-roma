import { useEffect } from 'react'
import { useBranchesStore } from '@/stores/branchesStore'

// Thin wrapper around the shared branches store, so every component reading
// branch data sees the same list — a delete/edit in one place is instantly
// reflected everywhere else (branch switcher, sale/transfer forms, etc.)
// instead of each call site holding its own stale local copy.
export function useBranches() {
  const branches = useBranchesStore((s) => s.branches)
  const loading = useBranchesStore((s) => s.loading)
  const error = useBranchesStore((s) => s.error)
  const fetched = useBranchesStore((s) => s.fetched)
  const reload = useBranchesStore((s) => s.reload)
  const createBranch = useBranchesStore((s) => s.createBranch)
  const updateBranch = useBranchesStore((s) => s.updateBranch)
  const softDeleteBranch = useBranchesStore((s) => s.softDeleteBranch)

  useEffect(() => {
    if (!fetched) reload()
  }, [fetched, reload])

  return { branches, loading: loading && !fetched, error, reload, createBranch, updateBranch, softDeleteBranch }
}
