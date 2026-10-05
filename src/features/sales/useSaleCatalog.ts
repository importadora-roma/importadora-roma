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
  barcodes: string[]
}

function normalizeBarcode(c: string): string {
  return c.replace(/[\s-]/g, '').toLowerCase()
}

// Shared by the product search box (typed/scanned-into-the-field matching)
// and the page-level USB scanner fallback, so a fardo scans to the same
// result wherever the keystrokes land.
export function findCatalogEntryByCode(catalog: CatalogEntry[], raw: string): CatalogEntry | undefined {
  const code = normalizeBarcode(raw)
  if (!code) return undefined
  return catalog.find((c) => c.barcodes.some((b) => normalizeBarcode(b) === code))
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
        barcodes: [...(v.sku ? [v.sku] : []), ...(v.extra_barcodes ?? [])],
      }))
  }, [products, variants, inventory, branchId])

  return { catalog, loading: loadingProducts || loadingInventory, reloadInventory }
}
