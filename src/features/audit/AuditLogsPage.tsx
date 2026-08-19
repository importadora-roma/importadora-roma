import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/format'
import { useAuditLogs } from './useAuditLogs'
import { useUsers } from '@/features/users/useUsers'

export function AuditLogsPage() {
  const { logs, loading, hasMore, error, loadMore } = useAuditLogs()
  const { users } = useUsers()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const userNameById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name])), [users])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return logs
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(term) ||
        (l.table_name ?? '').toLowerCase().includes(term) ||
        (l.user_id ? (userNameById.get(l.user_id) ?? '').toLowerCase().includes(term) : false)
    )
  }, [logs, search, userNameById])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Auditoría</h1>
      <p className="mt-1 text-sm text-slate-500">Registro de cambios sensibles: anulaciones, cambios de precio, roles.</p>

      <div className="mt-4">
        <Input placeholder="Buscar por acción, tabla o usuario..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-8 px-4 py-3" />
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Acción</th>
              <th className="px-4 py-3">Tabla</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Sin registros.
                </td>
              </tr>
            )}
            {filtered.map((log) => (
              <Fragment key={log.id}>
                <tr className="cursor-pointer" onClick={() => toggle(log.id)}>
                  <td className="px-4 py-3 text-slate-400">
                    {expanded.has(log.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(log.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700">{log.user_id ? userNameById.get(log.user_id) ?? '—' : 'Sistema'}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{log.action}</td>
                  <td className="px-4 py-3 text-slate-500">{log.table_name ?? '—'}</td>
                </tr>
                {expanded.has(log.id) && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3">
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <p className="mb-1 font-medium text-slate-500">Antes</p>
                          <pre className="overflow-auto rounded bg-white p-2 text-slate-700">{JSON.stringify(log.old_data, null, 2)}</pre>
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-slate-500">Después</p>
                          <pre className="overflow-auto rounded bg-white p-2 text-slate-700">{JSON.stringify(log.new_data, null, 2)}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && !search && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loading}>
            {loading ? 'Cargando...' : 'Cargar más'}
          </Button>
        </div>
      )}
    </div>
  )
}
