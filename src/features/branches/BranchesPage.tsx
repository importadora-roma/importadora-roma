import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { useBranches } from './useBranches'
import type { Branch, BranchType } from '@/types/models'

interface BranchForm {
  name: string
  address: string
  phone: string
  branch_type: BranchType
}

const emptyForm: BranchForm = { name: '', address: '', phone: '', branch_type: 'importadora' }

const typeLabels: Record<BranchType, string> = { importadora: 'Importadora', tienda: 'Mağaza' }

export function BranchesPage() {
  const { branches, loading, error, createBranch, updateBranch, softDeleteBranch } = useBranches()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [form, setForm] = useState<BranchForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null)

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(branch: Branch) {
    setEditing(branch)
    setForm({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '', branch_type: branch.branch_type })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('El nombre es obligatorio')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      branch_type: form.branch_type,
    }
    const { error } = editing ? await updateBranch(editing.id, payload) : await createBranch(payload)
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setModalOpen(false)
  }

  async function toggleActive(branch: Branch) {
    await updateBranch(branch.id, { active: !branch.active })
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sucursales</h1>
          <p className="mt-1 text-sm text-slate-500">Gestiona las sucursales de Importadora Roma.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          Nueva sucursal
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Dirección</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && branches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No hay sucursales registradas todavía.
                </td>
              </tr>
            )}
            {branches.map((branch) => (
              <tr key={branch.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{branch.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      branch.branch_type === 'importadora' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {typeLabels[branch.branch_type]}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{branch.address || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{branch.phone || '—'}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(branch)}
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      branch.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {branch.active ? 'Activa' : 'Inactiva'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => openEdit(branch)} className="text-slate-400 hover:text-slate-700">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setDeleteTarget(branch)} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar sucursal' : 'Nueva sucursal'}>
        <div className="space-y-4">
          <Input
            label="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej: Casa Matriz - Temuco"
          />
          <Select
            label="Tipo de sucursal"
            value={form.branch_type}
            onChange={(e) => setForm({ ...form, branch_type: e.target.value as BranchType })}
          >
            <option value="importadora">Importadora (ventas, caja, stock por fardo)</option>
            <option value="tienda">Mağaza (solo recibe stock por traslado, sin ventas/caja)</option>
          </Select>
          <Input
            label="Dirección"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <Input label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Eliminar "${deleteTarget?.name}"`}
        confirmLabel="Eliminar"
        onConfirm={(reason) => softDeleteBranch(deleteTarget!.id, reason)}
      />
    </div>
  )
}
