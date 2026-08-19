import { create } from 'zustand'

const STORAGE_KEY = 'roma-active-branch-id'

interface ActiveBranchState {
  branchId: string
  setBranchId: (id: string) => void
}

export const useActiveBranchStore = create<ActiveBranchState>((set) => ({
  branchId: localStorage.getItem(STORAGE_KEY) ?? '',
  setBranchId: (id) => {
    localStorage.setItem(STORAGE_KEY, id)
    set({ branchId: id })
  },
}))
