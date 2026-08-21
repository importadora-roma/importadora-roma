import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { formatKilo } from '@/lib/format'
import { useProducts } from '@/features/products/useProducts'
import { useTranslation } from '@/i18n/I18nProvider'
import type { ContainerItem } from './types'

// Container items carry product_name + calidad only (no kilo — the physical
// bale weight isn't part of the supplier's shipping list), so mapping to a
// specific product_variants row (which is keyed by calidad × kilo) is
// inherently a judgment call the admin makes here, not something the system
// can infer automatically.
export function VariantMappingModal({
  open,
  onClose,
  containerId,
  items,
  onDone,
}: {
  open: boolean
  onClose: () => void
  containerId: string
  items: ContainerItem[]
  onDone: (summary: { itemsPushed: number; itemsSkippedUnmapped: number }) => void
}) {
  const { t } = useTranslation()
  const { products, variants } = useProducts()
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function variantLabel(variantId: string): string {
    const variant = variants.find((v) => v.id === variantId)
    if (!variant) return ''
    const product = products.find((p) => p.id === variant.product_id)
    return `${product?.name ?? '?'} — ${variant.calidad} — ${formatKilo(variant.kilo)}`
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const variantMappings = Object.entries(mapping)
      .filter(([, variantId]) => variantId)
      .map(([containerItemId, variantId]) => ({ container_item_id: containerItemId, variant_id: variantId }))

    const { data, error } = await supabase.rpc('push_container_to_inventory', {
      p_container_id: containerId,
      p_variant_mappings: variantMappings.length > 0 ? variantMappings : null,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone(data as unknown as { itemsPushed: number; itemsSkippedUnmapped: number })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('variantMapping.title')}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('variantMapping.instructions')}</p>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {items.map((item) => (
            <div key={item.id}>
              <p className="text-sm font-medium text-slate-700">
                {item.product_name} {item.calidad ? `— ${item.calidad}` : ''}{' '}
                <span className="font-mono text-xs text-slate-400">({item.code})</span>
              </p>
              <select
                value={mapping[item.id] ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, [item.id]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">{t('variantMapping.skip')}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v.id)}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-slate-400">{t('variantMapping.allMapped')}</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('newContainer.headerSelect.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('variantMapping.processing') : t('variantMapping.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
