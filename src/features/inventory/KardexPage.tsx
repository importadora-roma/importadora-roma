import { useMemo, useState } from 'react'
import { Select, Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatDateTime, formatKilo } from '@/lib/format'
import { useKardex } from './useKardex'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useProducts } from '@/features/products/useProducts'
import type { InventoryMovementType } from '@/types/database'

const movementLabels: Record<InventoryMovementType, string> = {
  sale: 'Venta',
  sale_cancel: 'Anulación/Cambio',
  purchase: 'Compra',
  transfer_out: 'Traslado (salida)',
  transfer_in: 'Traslado (entrada)',
  adjustment: 'Ajuste',
  initial: 'Carga inicial',
}

const movementColors: Record<InventoryMovementType, string> = {
  sale: 'text-red-600',
  sale_cancel: 'text-green-600',
  purchase: 'text-green-600',
  transfer_out: 'text-amber-600',
  transfer_in: 'text-green-600',
  adjustment: 'text-slate-600',
  initial: 'text-slate-600',
}

export function KardexPage() {
  const { branchId: activeBranchId, branches } = useEffectiveBranch()
  const { products, variants } = useProducts()
  const [branchId, setBranchId] = useState(activeBranchId)
  const [search, setSearch] = useState('')
  const { entries, loading, hasMore, error, loadMore } = useKardex(branchId)

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants])
  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((e) => {
      const variant = variantById.get(e.variant_id)
      const productName = variant ? productNameById.get(variant.product_id) ?? '' : ''
      return productName.toLowerCase().includes(term) || (variant?.calidad ?? '').toLowerCase().includes(term)
    })
  }, [entries, search, variantById, productNameById])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Kardex</h1>
      <p className="mt-1 text-sm text-slate-500">Historial de movimientos de inventario.</p>

      <div className="mt-4 flex gap-3">
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
          <option value="">Todas las sucursales</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Input placeholder="Buscar producto o calidad..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Sucursal</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cantidad</th>
              <th className="px-4 py-3">Notas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Sin movimientos.
                </td>
              </tr>
            )}
            {filtered.map((entry) => {
              const variant = variantById.get(entry.variant_id)
              const productName = variant ? productNameById.get(variant.product_id) ?? '—' : '—'
              return (
                <tr key={entry.id}>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(entry.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{productName}</span>
                    {variant && <span className="text-slate-500"> — {variant.calidad} {formatKilo(variant.kilo)}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{branchNameById.get(entry.branch_id) ?? '—'}</td>
                  <td className="px-4 py-3">{movementLabels[entry.movement_type]}</td>
                  <td className={`px-4 py-3 font-medium ${movementColors[entry.movement_type]}`}>
                    {entry.quantity > 0 ? '+' : ''}
                    {entry.quantity}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{entry.notes || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {hasMore && !search && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loading}>
            {loading ? 'Cargando...' : 'Cargar más'}
          </Button>
        </div>
      )}
    </div>
  )
}
