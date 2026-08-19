import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'

export function BranchSwitcher() {
  const { branchId, setBranchId, isAdmin, branches } = useEffectiveBranch()
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null)

  const currentBranch = branches.find((b) => b.id === branchId)
  const pendingBranch = branches.find((b) => b.id === pendingBranchId)

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
        <Building2 size={16} className="text-slate-400" />
        <span className="font-medium">{currentBranch?.name ?? 'Sin sucursal asignada'}</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        <Building2 size={16} className="text-amber-600" />
        <select
          value={branchId}
          onChange={(e) => setPendingBranchId(e.target.value)}
          className="bg-transparent font-medium text-amber-900 focus:outline-none"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <Modal open={!!pendingBranchId} onClose={() => setPendingBranchId(null)} title="Cambiar de sucursal">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Vas a trabajar en <span className="font-medium text-slate-900">{pendingBranch?.name}</span> en lugar de{' '}
            <span className="font-medium text-slate-900">{currentBranch?.name}</span>. Ventas, caja y stock que
            registres a partir de ahora serán de esta sucursal.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingBranchId(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (pendingBranchId) setBranchId(pendingBranchId)
                setPendingBranchId(null)
              }}
            >
              Confirmar cambio
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
