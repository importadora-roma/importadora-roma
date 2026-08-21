import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { formatDate } from '@/lib/format'
import { useTranslation } from '@/i18n/I18nProvider'
import { useContainers } from './useContainers'
import type { ContainerStatus } from '@/types/database'

const statusKey: Record<ContainerStatus, string> = {
  draft: 'status.draft',
  importing: 'status.importing',
  counting: 'status.counting',
  completed: 'status.completed',
}

const statusClass: Record<ContainerStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  importing: 'bg-slate-100 text-slate-600',
  counting: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
}

interface Summary {
  container_id: string
  expected_qty: number
  scanned_qty: number
  items_total: number
  items_complete: number
  pending_unknown_count: number
}

export function ContainerHistoryPage() {
  const { t } = useTranslation()
  const { branchId } = useEffectiveBranch()
  const { containers, loading } = useContainers(branchId)
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (containers.length === 0) return
    supabase
      .from('container_summary')
      .select('*')
      .in(
        'container_id',
        containers.map((c) => c.id)
      )
      .then(({ data }) => {
        const map: Record<string, Summary> = {}
        for (const row of (data ?? []) as unknown as Summary[]) map[row.container_id] = row
        setSummaries(map)
      })
  }, [containers])

  const filtered = containers.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.code.toLowerCase().includes(q) || (c.internal_number ?? '').toLowerCase().includes(q) || (c.supplier ?? '').toLowerCase().includes(q)
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{t('containerHistory.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('containerHistory.subtitle')}</p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('containerHistory.searchPlaceholder')}
        className="mt-4 w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">{t('containerHistory.loading')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('containerHistory.col.container')}</th>
                <th className="px-4 py-2">{t('containerHistory.col.date')}</th>
                <th className="px-4 py-2">{t('containerHistory.col.supplier')}</th>
                <th className="px-4 py-2 text-right">{t('containerHistory.col.expected')}</th>
                <th className="px-4 py-2 text-right">{t('containerHistory.col.scanned')}</th>
                <th className="px-4 py-2 text-right">{t('containerHistory.col.diff')}</th>
                <th className="px-4 py-2">{t('containerHistory.col.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => {
                const s = summaries[c.id]
                const diff = s ? s.scanned_qty - s.expected_qty : null
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={c.status === 'completed' ? `/contenedores/historial/${c.id}` : `/contenedores/activo/${c.id}`}
                        className="block"
                      >
                        <p className="font-medium text-slate-900">{c.internal_number}</p>
                        <p className="text-xs text-slate-500">{c.code}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.arrival_date ? formatDate(c.arrival_date) : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.supplier ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{s?.expected_qty ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{s?.scanned_qty ?? '—'}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        diff === null ? '' : diff === 0 ? 'text-green-700' : diff < 0 ? 'text-amber-700' : 'text-red-600'
                      }`}
                    >
                      {diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[c.status]}`}>{t(statusKey[c.status])}</span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    {t('containerHistory.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
