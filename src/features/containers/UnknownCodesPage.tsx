import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useTranslation } from '@/i18n/I18nProvider'
import { useUnknownCodesForBranch, resolveUnknownCode, type UnknownCodeWithContainer } from './useUnknownCodes'
import { UnknownCodeResolveDialog } from './UnknownCodeResolveDialog'
import type { ContainerItem } from './types'

export function UnknownCodesPage() {
  const { t } = useTranslation()
  const { branchId } = useEffectiveBranch()
  const { items, loading, reload } = useUnknownCodesForBranch(branchId)
  const [active, setActive] = useState<UnknownCodeWithContainer | null>(null)
  const [activeItems, setActiveItems] = useState<ContainerItem[]>([])

  async function openResolve(row: UnknownCodeWithContainer) {
    const { data } = await supabase
      .from('container_items')
      .select('*')
      .eq('container_id', row.container_id)
      .is('deleted_at', null)
    setActiveItems((data ?? []) as unknown as ContainerItem[])
    setActive(row)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{t('unknownPage.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('unknownPage.subtitle')}</p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-400">{t('unknownPage.loading')}</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">{t('unknownPage.empty')}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">{t('unknownPage.col.code')}</th>
                <th className="px-4 py-2">{t('unknownPage.col.container')}</th>
                <th className="px-4 py-2 text-right">{t('unknownPage.col.timesScanned')}</th>
                <th className="px-4 py-2">{t('unknownPage.col.status')}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono text-slate-900">{row.first_raw_code}</td>
                  <td className="px-4 py-3">
                    <Link to={`/contenedores/activo/${row.container_id}`} className="text-slate-600 hover:underline">
                      {row.container_internal_number ?? row.container_code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{row.scan_count}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                      {row.status === 'pending' ? t('unknownPage.status.pending') : t('unknownPage.status.reviewLater')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openResolve(row)} className="text-sm font-medium text-slate-700 hover:underline">
                      {t('unknownPage.resolve')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UnknownCodeResolveDialog
        open={!!active}
        onClose={() => setActive(null)}
        unknownCode={active}
        containerItems={activeItems}
        onResolve={async (action, payload) => {
          if (!active) return { error: 'Sin selección' }
          const { error } = await resolveUnknownCode(active.container_id, active.code_normalized, action, payload)
          if (!error) await reload()
          return { error }
        }}
      />
    </div>
  )
}
