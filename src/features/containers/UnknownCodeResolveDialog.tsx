import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { formatKilo } from '@/lib/format'
import { useProducts } from '@/features/products/useProducts'
import { useTranslation } from '@/i18n/I18nProvider'
import type { ContainerItem, UnknownCode } from './types'

type Action = 'add_to_list' | 'manual_match' | 'ignore' | 'review_later'
type MatchTarget = 'container_item' | 'catalog'

const actionKey: Record<Action, string> = {
  add_to_list: 'unknownDialog.action.add',
  manual_match: 'unknownDialog.action.manual',
  ignore: 'unknownDialog.action.ignore',
  review_later: 'unknownDialog.action.later',
}

export interface ResolvePayload {
  productName?: string
  calidad?: string
  expectedQty?: number
  matchedItemId?: string
  variantId?: string
  notes?: string
}

export function UnknownCodeResolveDialog({
  open,
  onClose,
  unknownCode,
  containerItems,
  onResolve,
}: {
  open: boolean
  onClose: () => void
  unknownCode: UnknownCode | null
  containerItems: ContainerItem[]
  onResolve: (action: Action, payload: ResolvePayload) => Promise<{ error: string | null }>
}) {
  const { t } = useTranslation()
  const { products, variants } = useProducts()
  const [action, setAction] = useState<Action>('manual_match')
  const [matchTarget, setMatchTarget] = useState<MatchTarget>('catalog')
  const [productName, setProductName] = useState('')
  const [calidad, setCalidad] = useState('')
  const [expectedQty, setExpectedQty] = useState('')
  const [matchedItemId, setMatchedItemId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const activeVariants = useMemo(() => variants.filter((v) => v.active), [variants])

  function reset() {
    setAction('manual_match')
    setMatchTarget('catalog')
    setProductName('')
    setCalidad('')
    setExpectedQty('')
    setMatchedItemId('')
    setVariantId('')
    setNotes('')
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (action === 'add_to_list' && (!productName.trim() || !expectedQty.trim())) {
      setError(t('unknownDialog.errorMissingProduct'))
      return
    }
    if (action === 'manual_match' && matchTarget === 'container_item' && !matchedItemId) {
      setError(t('unknownDialog.errorMissingMatch'))
      return
    }
    if (action === 'manual_match' && matchTarget === 'catalog' && !variantId) {
      setError(t('unknownDialog.errorMissingMatch'))
      return
    }
    setSubmitting(true)
    const { error } = await onResolve(action, {
      productName: productName.trim() || undefined,
      calidad: calidad.trim() || undefined,
      expectedQty: expectedQty.trim() ? Number(expectedQty) : undefined,
      matchedItemId: matchTarget === 'container_item' ? matchedItemId || undefined : undefined,
      variantId: matchTarget === 'catalog' ? variantId || undefined : undefined,
      notes: notes.trim() || undefined,
    })
    setSubmitting(false)
    if (error) {
      setError(error)
      return
    }
    reset()
    onClose()
  }

  if (!unknownCode) return null

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={t('unknownDialog.title')}
    >
      <div className="space-y-4">
        <div className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <p className="font-mono">{unknownCode.first_raw_code}</p>
          <p className="mt-0.5 text-xs">{t('unknownDialog.scannedTimes', { count: unknownCode.scan_count })}</p>
        </div>

        <Select label={t('unknownDialog.actionLabel')} value={action} onChange={(e) => setAction(e.target.value as Action)}>
          {(Object.keys(actionKey) as Action[]).map((value) => (
            <option key={value} value={value}>
              {t(actionKey[value])}
            </option>
          ))}
        </Select>

        {action === 'add_to_list' && (
          <>
            <Input label={t('unknownDialog.product')} value={productName} onChange={(e) => setProductName(e.target.value)} />
            <Input label={t('unknownDialog.quality')} value={calidad} onChange={(e) => setCalidad(e.target.value)} />
            <Input
              label={t('unknownDialog.expectedQty')}
              type="number"
              value={expectedQty}
              onChange={(e) => setExpectedQty(e.target.value)}
            />
          </>
        )}

        {action === 'manual_match' && (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMatchTarget('catalog')}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
                  matchTarget === 'catalog' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                }`}
              >
                {t('unknownDialog.matchCatalog')}
              </button>
              <button
                type="button"
                onClick={() => setMatchTarget('container_item')}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
                  matchTarget === 'container_item' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                }`}
              >
                {t('unknownDialog.matchContainerItem')}
              </button>
            </div>

            {matchTarget === 'catalog' ? (
              <>
                <Select label={t('unknownDialog.selectProduct')} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="">{t('unknownDialog.selectPlaceholder')}</option>
                  {activeVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {productNameById.get(v.product_id) ?? '—'} — {v.calidad} {formatKilo(v.kilo)}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-400">{t('unknownDialog.catalogHint')}</p>
              </>
            ) : (
              <Select label={t('unknownDialog.selectProduct')} value={matchedItemId} onChange={(e) => setMatchedItemId(e.target.value)}>
                <option value="">{t('unknownDialog.selectPlaceholder')}</option>
                {containerItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.product_name} {item.calidad ? `— ${item.calidad}` : ''} {item.code ? `(${item.code})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}

        {(action === 'ignore' || action === 'review_later') && (
          <Textarea label={t('unknownDialog.notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('newContainer.headerSelect.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('unknownDialog.processing') : t('unknownDialog.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
