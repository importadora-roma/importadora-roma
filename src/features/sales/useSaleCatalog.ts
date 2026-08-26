import { useMemo } from 'react'
import { useProducts } from '@/features/products/useProducts'
import { useInventory } from '@/features/inventory/useInventory'

export interface CatalogEntry {
  variantId: string
  productName: string
  calidad: string
  kilo: number
  price: number
  cost: number
  stock: number
  sku: string | null
}

export function useSaleCatalog(branchId: string) {
  const { products, variants, loading: loadingProducts } = useProducts()
  const { inventory, loading: loadingInventory, reload: reloadInventory } = useInventory()

  const catalog: CatalogEntry[] = useMemo(() => {
    const productNameById = new Map(products.map((p) => [p.id, p.name]))
    return variants
      .filter((v) => v.active)
      .map((v) => ({
        variantId: v.id,
        productName: productNameById.get(v.product_id) ?? '—',
        calidad: v.calidad,
        kilo: v.kilo,
        price: v.price,
        cost: v.cost,
        stock: inventory.find((i) => i.variant_id === v.id && i.branch_id === branchId)?.quantity ?? 0,
        sku: v.sku,
      }))
  }, [products, variants, inventory, branchId])

  return { catalog, loading: loadingProducts || loadingInventory, reloadInventory }
}
