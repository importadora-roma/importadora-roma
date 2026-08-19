import { Info } from 'lucide-react'
import { useUsers } from './useUsers'
import { useBranches } from '@/features/branches/useBranches'
import type { UserRole } from '@/types/models'

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
}

export function UsersPage() {
  const { users, loading, error, updateUser } = useUsers()
  const { branches } = useBranches()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Usuarios</h1>
      <p className="mt-1 text-sm text-slate-500">Asigna rol y sucursal a cada usuario.</p>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Para crear un usuario nuevo, ve a tu proyecto de Supabase → Authentication → Users → Add user. Aparecerá
          aquí automáticamente con rol "Vendedor" para que le asignes rol y sucursal.
        </p>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Sucursal</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
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
                  <button
                    onClick={() => updateUser(user.id, { active: !user.active })}
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      user.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {user.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
