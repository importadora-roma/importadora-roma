import { useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/I18nProvider'
import type { ItemProgressStatus, ItemWithProgress } from './types'

type Filter = 'all' | 'complete' | 'missing' | 'over'

const statusKey: Record<ItemProgressStatus, string> = {
  empty: 'itemStatus.empty',
  partial: 'itemStatus.partial',
  complete: 'itemStatus.complete',
  over: 'itemStatus.over',
}

const statusClass: Record<ItemProgressStatus, string> = {
  empty: 'bg-slate-100 text-slate-600',
  partial: 'bg-amber-100 text-amber-700',
  complete: 'bg-green-100 text-green-700',
  over: 'bg-red-100 text-red-700',
}

const filterKey: Record<Filter, string> = {
  all: 'itemTable.filter.all',
  complete: 'itemTable.filter.complete',
  missing: 'itemTable.filter.missing',
  over: 'itemTable.filter.over',
}

export function ItemComparisonTable({ items }: { items: ItemWithProgress[] }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [calidadFilter, setCalidadFilter] = useState('')
  const [search, setSearch] = useState('')

  const calidades = useMemo(
    () => Array.from(new Set(items.map((i) => i.calidad).filter((c): c is string => !!c))),
    [items]
  )

  const filtered = items.filter((item) => {
    if (filter === 'complete' && item.itemStatus !== 'complete') return false
    if (filter === 'missing' && item.itemStatus !== 'partial' && item.itemStatus !== 'empty') return false
    if (filter === 'over' && item.itemStatus !== 'over') return false
    if (calidadFilter && item.calidad !== calidadFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!item.product_name.toLowerCase().includes(q) && !(item.code ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'complete', 'missing', 'over'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t(filterKey[f])}
          </button>
        ))}
        {calidades.length > 0 && (
          <select
            value={calidadFilter}
            onChange={(e) => setCalidadFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">{t('itemTable.allQualities')}</option>
            {calidades.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('itemTable.searchPlaceholder')}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">{t('itemTable.col.product')}</th>
              <th className="px-3 py-2">{t('itemTable.col.quality')}</th>
              <th className="px-3 py-2">{t('itemTable.col.code')}</th>
              <th className="px-3 py-2 text-right">{t('itemTable.col.expected')}</th>
              <th className="px-3 py-2 text-right">{t('itemTable.col.scanned')}</th>
              <th className="px-3 py-2 text-right">{t('itemTable.col.remaining')}</th>
              <th className="px-3 py-2">{t('itemTable.col.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 font-medium text-slate-900">{item.product_name}</td>
                <td className="px-3 py-2 text-slate-600">{item.calidad ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.code ?? '—'}</td>
                <td className="px-3 py-2 text-right">{item.expected_qty}</td>
                <td className="px-3 py-2 text-right">{item.scannedQty}</td>
                <td className="px-3 py-2 text-right">{item.remaining}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[item.itemStatus]}`}>
                    {t(statusKey[item.itemStatus])}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  {t('itemTable.noResults')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
