import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useContainers } from './useContainers'
import { formatDate } from '@/lib/format'
import { useTranslation } from '@/i18n/I18nProvider'
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

export function ActiveCountingPage() {
  const { branchId } = useEffectiveBranch()
  const { containers, loading } = useContainers(branchId)
  const { t } = useTranslation()

  const actionable = containers.filter((c) => c.status !== 'completed')

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('activeList.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('activeList.subtitle')}</p>
        </div>
        <Link to="/contenedores/nuevo">
          <Button>
            <Plus size={16} /> {t('activeList.newButton')}
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">{t('activeList.loading')}</p>
      ) : actionable.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{t('activeList.empty')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('activeList.col.container')}</th>
                <th className="px-4 py-2">{t('activeList.col.supplier')}</th>
                <th className="px-4 py-2">{t('activeList.col.arrival')}</th>
                <th className="px-4 py-2">{t('activeList.col.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actionable.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/contenedores/activo/${c.id}`} className="block">
                      <p className="font-medium text-slate-900">{c.internal_number}</p>
                      <p className="text-xs text-slate-500">{c.code}</p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.supplier ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.arrival_date ? formatDate(c.arrival_date) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[c.status]}`}>
                      {t(statusKey[c.status])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
