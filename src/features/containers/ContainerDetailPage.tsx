import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/format'
import { useTranslation } from '@/i18n/I18nProvider'
import { useBranches } from '@/features/branches/useBranches'
import { useContainerDetail } from './useContainerDetail'
import { ContainerSummaryHeader } from './ContainerSummaryHeader'
import { ItemComparisonTable } from './ItemComparisonTable'
import { exportContainerExcel } from './containerExcel'
import { generateContainerPdf } from './containerPdf'
import { VariantMappingModal } from './VariantMappingModal'

type Tab = 'resumen' | 'items' | 'historial' | 'desconocidos'

const tabKey: Record<Tab, string> = {
  resumen: 'containerDetail.tab.summary',
  items: 'containerDetail.tab.items',
  historial: 'containerDetail.tab.history',
  desconocidos: 'containerDetail.tab.unknown',
}

export function ContainerDetailPage() {
  const { containerId } = useParams<{ containerId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const profile = useAuthStore((s) => s.profile)
  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'

  const { container, items, itemsWithProgress, events, unknownCodes, totals, loading, error, reload, setContainerStatusLocal } =
    useContainerDetail(containerId ?? null)
  const { branches } = useBranches()
  const [tab, setTab] = useState<Tab>('resumen')
  const [mappingOpen, setMappingOpen] = useState(false)
  const [pushResult, setPushResult] = useState<{ itemsPushed: number; itemsSkippedUnmapped: number } | null>(null)
  const [reopening, setReopening] = useState(false)

  if (loading) return <p className="text-sm text-slate-400">{t('activeScreen.loading')}</p>
  if (error || !container) return <p className="text-sm text-red-600">{error ?? t('activeScreen.notFound')}</p>

  async function handleReopen() {
    setReopening(true)
    const { error } = await supabase.rpc('set_container_status', { p_container_id: containerId!, p_new_status: 'counting' })
    setReopening(false)
    if (!error) {
      setContainerStatusLocal('counting')
      navigate(`/contenedores/activo/${containerId}`)
    }
  }

  const unmappedItems = items.filter((i) => !i.variant_id)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{container.internal_number}</h1>
          <p className="text-sm text-slate-500">
            {container.code}
            {container.supplier ? ` · ${container.supplier}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportContainerExcel(container, itemsWithProgress, events, unknownCodes)}>
            <Download size={16} /> {t('containerDetail.excel')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const branch = branches.find((b) => b.id === container.branch_id)
              generateContainerPdf(
                container,
                itemsWithProgress,
                unknownCodes.length,
                branch ? { name: branch.name, address: branch.address } : undefined
              )
            }}
          >
            <FileText size={16} /> {t('containerDetail.pdf')}
          </Button>
          {canManage && container.status === 'completed' && (
            <Button variant="secondary" onClick={handleReopen} disabled={reopening}>
              {reopening ? t('containerDetail.reopening') : t('containerDetail.reopen')}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6">
        <ContainerSummaryHeader totals={totals} />
      </div>

      {canManage && container.status === 'completed' && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          {unmappedItems.length === 0 ? (
            <p className="text-sm text-green-700">{t('containerDetail.pushed')}</p>
          ) : (
            <>
              <p className="text-sm text-amber-700">{t('containerDetail.unmappedRemaining', { count: unmappedItems.length })}</p>
              <Button className="mt-2" onClick={() => setMappingOpen(true)}>
                {t('containerDetail.pushToInventory')}
              </Button>
            </>
          )}
          {pushResult && (
            <p className="mt-2 text-sm text-slate-600">
              {t('containerDetail.pushResult', { pushed: pushResult.itemsPushed, skipped: pushResult.itemsSkippedUnmapped })}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex gap-2 border-b border-slate-200">
        {(Object.keys(tabKey) as Tab[]).map((tKey) => (
          <button
            key={tKey}
            onClick={() => setTab(tKey)}
            className={`px-3 py-2 text-sm font-medium ${tab === tKey ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t(tabKey[tKey])}
          </button>
        ))}
      </div>

      {tab === 'resumen' && (
        <div className="mt-4 space-y-1 text-sm text-slate-600">
          <p>{t('containerDetail.supplier', { value: container.supplier ?? '—' })}</p>
          <p>{t('containerDetail.arrival', { value: container.arrival_date ?? '—' })}</p>
          <p>{t('containerDetail.notes', { value: container.notes ?? '—' })}</p>
          {container.reopen_count > 0 && <p>{t('containerDetail.reopenedTimes', { count: container.reopen_count })}</p>}
        </div>
      )}

      {tab === 'items' && <ItemComparisonTable items={itemsWithProgress} />}

      {tab === 'historial' && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">{t('containerDetail.history.colDate')}</th>
                <th className="px-3 py-2">{t('containerDetail.history.colCode')}</th>
                <th className="px-3 py-2">{t('containerDetail.history.colType')}</th>
                <th className="px-3 py-2">{t('containerDetail.history.colMethod')}</th>
                <th className="px-3 py-2 text-right">{t('containerDetail.history.colQty')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...events].reverse().map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(e.created_at)}</td>
                  <td className="px-3 py-2 font-mono">{e.code_raw}</td>
                  <td className="px-3 py-2">{e.event_type === 'undo' ? t('containerDetail.history.typeUndo') : t('containerDetail.history.typeScan')}</td>
                  <td className="px-3 py-2">{e.method}</td>
                  <td className="px-3 py-2 text-right">{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    {t('containerDetail.history.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'desconocidos' && (
        <div className="mt-4 space-y-2">
          {unknownCodes.length === 0 ? (
            <p className="text-sm text-slate-400">{t('containerDetail.unknown.none')}</p>
          ) : (
            unknownCodes.map((u) => (
              <div key={u.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <p className="font-mono">
                  {u.first_raw_code} <span className="text-slate-400">{t('containerDetail.unknown.times', { count: u.scan_count })}</span>
                </p>
                <p className="text-xs text-slate-500">{t('containerDetail.unknown.status', { value: u.status })}</p>
              </div>
            ))
          )}
        </div>
      )}

      <VariantMappingModal
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        containerId={containerId!}
        items={unmappedItems}
        onDone={(summary) => {
          setPushResult(summary)
          reload()
        }}
      />
    </div>
  )
}
