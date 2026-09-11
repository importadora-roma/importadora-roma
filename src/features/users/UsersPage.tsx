import { useState } from 'react'
import { KeyRound, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { useUsers } from './useUsers'
import { useBranches } from '@/features/branches/useBranches'
import type { UserRole } from '@/types/models'

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
}

const emptyCreateForm = { fullName: '', email: '', password: '', role: 'vendedor' as UserRole, branchId: '', commissionPct: '0' }

export function UsersPage() {
  const { users, loading, error, updateUser, createUser, setUserPassword } = useUsers()
  const { branches } = useBranches()

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [passwordTarget, setPasswordTarget] = useState<{ id: string; name: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordOk, setPasswordOk] = useState(false)

  async function handleCreate() {
    setCreateError(null)
    if (!createForm.fullName.trim() || !createForm.email.trim()) {
      setCreateError('Nombre y correo son obligatorios')
      return
    }
    if (createForm.password.length < 6) {
      setCreateError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setCreating(true)
    const result = await createUser({
      email: createForm.email.trim(),
      password: createForm.password,
      full_name: createForm.fullName.trim(),
      role: createForm.role,
      branch_id: createForm.branchId || null,
      commission_pct: Number(createForm.commissionPct) || 0,
    })
    setCreating(false)
    if (result.error) {
      setCreateError(result.error)
      return
    }
    setCreateOpen(false)
    setCreateForm(emptyCreateForm)
  }

  function openPasswordModal(id: string, name: string) {
    setPasswordTarget({ id, name })
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
    setPasswordOk(false)
  }

  async function handleSetPassword() {
    setPasswordError(null)
    if (newPassword.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden')
      return
    }
    setSavingPassword(true)
    const result = await setUserPassword(passwordTarget!.id, newPassword)
    setSavingPassword(false)
    if (result.error) {
      setPasswordError(result.error)
      return
    }
    setPasswordOk(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Usuarios</h1>
          <p className="mt-1 text-sm text-slate-500">Crea usuarios, asigna rol y sucursal, y administra sus contraseñas.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus size={16} /> Crear usuario
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Sucursal</th>
              <th className="px-4 py-3">Comisión %</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{user.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{user.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    onChange={(e) => updateUser(user.id, { role: e.target.value as UserRole })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.branch_id ?? ''}
                    onChange={(e) => updateUser(user.id, { branch_id: e.target.value || null })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">Sin asignar</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    defaultValue={user.commission_pct}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (value !== user.commission_pct) updateUser(user.id, { commission_pct: value })
                    }}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => updateUser(user.id, { active: !user.active })}
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      user.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {user.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openPasswordModal(user.id, user.full_name)}
                    className="text-slate-400 hover:text-slate-700"
                    title="Cambiar contraseña"
                  >
                    <KeyRound size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Crear usuario">
        <div className="space-y-4">
          <Input label="Nombre" value={createForm.fullName} onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} />
          <Input
            label="Correo"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
          />
          <Input
            label="Contraseña"
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
          />
          <Select label="Rol" value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Sucursal" value={createForm.branchId} onChange={(e) => setCreateForm({ ...createForm, branchId: e.target.value })}>
            <option value="">Sin asignar</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Input
            label="Comisión %"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={createForm.commissionPct}
            onChange={(e) => setCreateForm({ ...createForm, commissionPct: e.target.value })}
          />
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creando...' : 'Crear usuario'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!passwordTarget} onClose={() => setPasswordTarget(null)} title={`Cambiar contraseña — ${passwordTarget?.name ?? ''}`}>
        <div className="space-y-4">
          {passwordOk ? (
            <p className="text-sm text-green-700">Contraseña actualizada correctamente.</p>
          ) : (
            <>
              <Input label="Nueva contraseña" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Input label="Confirmar contraseña" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPasswordTarget(null)}>
              {passwordOk ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!passwordOk && (
              <Button onClick={handleSetPassword} disabled={savingPassword}>
                {savingPassword ? 'Guardando...' : 'Guardar'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
