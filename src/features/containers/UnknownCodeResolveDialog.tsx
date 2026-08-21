import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { useTranslation } from '@/i18n/I18nProvider'
import type { ContainerItem, UnknownCode } from './types'

type Action = 'add_to_list' | 'manual_match' | 'ignore' | 'review_later'

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
  const [action, setAction] = useState<Action>('add_to_list')
  const [productName, setProductName] = useState('')
  const [calidad, setCalidad] = useState('')
  const [expectedQty, setExpectedQty] = useState('')
  const [matchedItemId, setMatchedItemId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setAction('add_to_list')
    setProductName('')
    setCalidad('')
    setExpectedQty('')
    setMatchedItemId('')
    setNotes('')
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (action === 'add_to_list' && (!productName.trim() || !expectedQty.trim())) {
      setError(t('unknownDialog.errorMissingProduct'))
      return
    }
    if (action === 'manual_match' && !matchedItemId) {
      setError(t('unknownDialog.errorMissingMatch'))
      return
    }
    setSubmitting(true)
    const { error } = await onResolve(action, {
      productName: productName.trim() || undefined,
      calidad: calidad.trim() || undefined,
      expectedQty: expectedQty.trim() ? Number(expectedQty) : undefined,
      matchedItemId: matchedItemId || undefined,
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
          <Select label={t('unknownDialog.selectProduct')} value={matchedItemId} onChange={(e) => setMatchedItemId(e.target.value)}>
            <option value="">{t('unknownDialog.selectPlaceholder')}</option>
            {containerItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.product_name} {item.calidad ? `— ${item.calidad}` : ''} ({item.code})
              </option>
            ))}
          </Select>
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
