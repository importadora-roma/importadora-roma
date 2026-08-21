import { useTranslation } from '@/i18n/I18nProvider'
import type { ContainerTotals } from './types'

export function ContainerSummaryHeader({ totals }: { totals: ContainerTotals }) {
  const { t } = useTranslation()
  const progressColor = totals.hasOver ? 'bg-red-600' : totals.percent >= 100 ? 'bg-green-600' : 'bg-slate-900'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label={t('summary.expected')} value={totals.expected} />
        <Stat label={t('summary.scanned')} value={totals.scanned} />
        <Stat
          label={t('summary.remaining')}
          value={totals.remaining}
          tone={totals.remaining < 0 ? 'red' : totals.remaining === 0 ? 'green' : 'default'}
        />
        <Stat label={t('summary.progress')} value={`${totals.percent}%`} />
      </div>
      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full transition-all ${progressColor}`} style={{ width: `${Math.min(totals.percent, 100)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <span className="text-slate-500">
          {t('summary.itemsComplete', { complete: totals.itemsComplete, total: totals.itemsTotal })}
        </span>
        {totals.hasOver && <span className="font-medium text-red-600">{t('summary.hasOver')}</span>}
        {totals.pendingUnknownCount > 0 && (
          <span className="font-medium text-orange-600">{t('summary.pendingUnknown', { count: totals.pendingUnknownCount })}</span>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'red' | 'green' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : 'text-slate-900'
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${toneClass}`}>{value}</p>
    </div>
  )
}
