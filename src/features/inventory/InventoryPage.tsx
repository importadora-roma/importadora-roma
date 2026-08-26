import { useMemo, useState } from 'react'
import { Pencil, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatKilo } from '@/lib/format'
import { exportToExcel } from '@/lib/excel'
import { useAuthStore } from '@/stores/authStore'
import { useInventory } from './useInventory'
import { useProducts } from '@/features/products/useProducts'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import type { ProductVariant } from '@/types/models'

export function InventoryPage() {
  const profile = useAuthStore((s) => s.profile)
  const canSeeCost = profile?.role === 'admin' || profile?.role === 'supervisor'
  const { branchId: effectiveBranchId, branches } = useEffectiveBranch()
  const { products, variants, loading: loadingProducts, updateVariant } = useProducts()
  const { inventory, loading: loadingInventory, adjustInventory } = useInventory()

  const [search, setSearch] = useState('')
  const [adjustTarget, setAdjustTarget] = useState<ProductVariant | null>(null)
  const [newQuantity, setNewQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [skuError, setSkuError] = useState<{ variantId: string; message: string } | null>(null)

  async function handleSkuBlur(variant: ProductVariant, value: string) {
    const next = value.trim() || null
    if (next === (variant.sku ?? null)) return
    const { error } = await updateVariant(variant.id, { sku: next })
    setSkuError(error ? { variantId: variant.id, message: error } : null)
  }

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return variants
      .filter((v) => v.active)
      .map((variant) => {
        const stock = inventory.find((i) => i.variant_id === variant.id && i.branch_id === effectiveBranchId)?.quantity ?? 0
        return { variant, productName: productNameById.get(variant.product_id) ?? '—', stock }
      })
      .filter(
        (row) =>
          !term || row.productName.toLowerCase().includes(term) || row.variant.calidad.toLowerCase().includes(term)
      )
  }, [variants, inventory, effectiveBranchId, productNameById, search])

  function openAdjust(variant: ProductVariant, currentStock: number) {
    setAdjustTarget(variant)
    setNewQuantity(String(currentStock))
    setReason('')
    setFormError(null)
  }

  async function handleAdjust() {
    const qty = Number(newQuantity)
    if (Number.isNaN(qty) || qty < 0) {
      setFormError('Ingresa una cantidad válida')
      return
    }
    if (!reason.trim()) {
      setFormError('Debes indicar un motivo')
      return
    }
    setSaving(true)
    const { error } = await adjustInventory(adjustTarget!.id, effectiveBranchId, qty, reason.trim())
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setAdjustTarget(null)
  }

  const loading = loadingProducts || loadingInventory

  function handleExport() {
    const branchName = branches.find((b) => b.id === effectiveBranchId)?.name ?? ''
    exportToExcel(`inventario-${branchName || 'sucursal'}.xlsx`, 'Inventario', [
      ...rows.map((row) => ({
        Producto: row.productName,
        Calidad: row.variant.calidad,
        Kilo: row.variant.kilo,
        SKU: row.variant.sku ?? '',
        Costo: row.variant.cost,
        Precio: row.variant.price,
        Stock: row.stock,
      })),
    ])
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Inventario</h1>
      <p className="mt-1 text-sm text-slate-500">
        Stock de {branches.find((b) => b.id === effectiveBranchId)?.name ?? 'la sucursal activa'} (cambia de sucursal
        arriba a la derecha).
      </p>

      <div className="mt-4 flex gap-3">
        <Input placeholder="Buscar producto o calidad..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Button variant="secondary" onClick={handleExport} disabled={rows.length === 0}>
          <Download size={16} />
          Exportar Excel
        </Button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Calidad</th>
              <th className="px-4 py-3">Kilo</th>
              <th className="px-4 py-3">Código (barra)</th>
              {canSeeCost && <th className="px-4 py-3">Costo</th>}
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={canSeeCost ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && !effectiveBranchId && (
              <tr>
                <td colSpan={canSeeCost ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                  Primero crea una sucursal en Configuración.
                </td>
              </tr>
            )}
            {!loading && effectiveBranchId && rows.length === 0 && (
              <tr>
                <td colSpan={canSeeCost ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                  No hay variantes de producto todavía.
                </td>
              </tr>
            )}
            {rows.map(({ variant, productName, stock }) => (
              <tr key={variant.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{productName}</td>
                <td className="px-4 py-3 text-slate-600">{variant.calidad}</td>
                <td className="px-4 py-3 text-slate-600">{formatKilo(variant.kilo)}</td>
                <td className="px-4 py-3">
                  {canSeeCost ? (
                    <>
                      <input
                        type="text"
                        defaultValue={variant.sku ?? ''}
                        placeholder="Sin código"
                        onBlur={(e) => handleSkuBlur(variant, e.target.value)}
                        className="w-36 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm"
                      />
                      {skuError?.variantId === variant.id && <p className="mt-0.5 text-xs text-red-600">{skuError.message}</p>}
                    </>
                  ) : (
                    <span className="font-mono text-slate-500">{variant.sku ?? '—'}</span>
                  )}
                </td>
                {canSeeCost && (
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      defaultValue={variant.cost}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (value !== variant.cost && !Number.isNaN(value) && value >= 0) updateVariant(variant.id, { cost: value })
                      }}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className={stock <= 0 ? 'text-red-600' : 'text-slate-900'}>{stock}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openAdjust(variant, stock)} className="text-slate-400 hover:text-slate-700">
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title="Ajustar stock">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {productNameById.get(adjustTarget?.product_id ?? '')} — {adjustTarget?.calidad} {adjustTarget && formatKilo(adjustTarget.kilo)}
          </p>
          <Input label="Nueva cantidad" type="number" min={0} value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} />
          <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: conteo físico, carga inicial..." />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAdjustTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleAdjust} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
