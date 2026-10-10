import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
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

const statusTone: Record<ContainerStatus, BadgeTone> = {
  draft: 'neutral',
  importing: 'neutral',
  counting: 'warning',
  completed: 'success',
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
        <Card className="mt-6 overflow-x-auto">
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
                    <Badge tone={statusTone[c.status]}>{t(statusKey[c.status])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
