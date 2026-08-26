import { useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { Printer, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatCLP, formatKilo } from '@/lib/format'
import { useProducts } from './useProducts'

// Deterministic from the variant id, so it's stable across re-prints and
// never collides — no round-trip needed to check uniqueness before saving.
function generateSku(variantId: string): string {
  return `RM${variantId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current) return
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      width: 1.6,
      height: 38,
      displayValue: false,
      margin: 0,
    })
  }, [value])

  return <svg ref={ref} />
}

export function PrintLabelsPage() {
  const { products, variants, updateVariant } = useProducts()
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [preparing, setPreparing] = useState(false)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const filteredVariants = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = variants.filter((v) => v.active)
    if (!q) return list
    return list.filter((v) => {
      const productName = productById.get(v.product_id)?.name ?? ''
      return productName.toLowerCase().includes(q) || v.calidad.toLowerCase().includes(q) || v.sku?.toLowerCase().includes(q)
    })
  }, [variants, search, productById])

  function setQty(variantId: string, qty: number) {
    setQuantities((q) => ({ ...q, [variantId]: Math.max(0, qty) }))
  }

  const selectedVariants = useMemo(() => variants.filter((v) => (quantities[v.id] ?? 0) > 0), [variants, quantities])

  const labelSheet = useMemo(
    () =>
      selectedVariants.flatMap((v) =>
        Array.from({ length: quantities[v.id] ?? 0 }, (_, i) => ({
          key: `${v.id}-${i}`,
          variant: v,
          product: productById.get(v.product_id),
        }))
      ),
    [selectedVariants, quantities, productById]
  )

  async function handlePrint() {
    setPreparing(true)
    // Any selected variant missing a SKU gets one generated and saved now,
    // so the barcode printed today keeps matching this product on future
    // scans (register checkout, re-prints, inventory lookups).
    for (const v of selectedVariants) {
      if (!v.sku) {
        await updateVariant(v.id, { sku: generateSku(v.id) })
      }
    }
    setPreparing(false)
    setTimeout(() => window.print(), 50)
  }

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #label-sheet, #label-sheet * { visibility: visible; }
          #label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
        }
        .label-card {
          width: 70mm;
          height: 38mm;
          padding: 3mm;
          box-sizing: border-box;
        }
      `}</style>

      <div className="no-print">
        <h1 className="text-2xl font-semibold text-slate-900">Etiquetas con código de barras</h1>
        <p className="mt-1 text-sm text-slate-500">
          Selecciona productos y cuántas etiquetas necesitas de cada uno. Si un producto no tiene SKU, se le genera uno automáticamente
          al imprimir.
        </p>

        <div className="mt-4 relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto..." className="pl-9" />
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Precio</th>
                <th className="px-4 py-2">Etiquetas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVariants.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-900">{productById.get(v.product_id)?.name}</span>
                    <span className="text-slate-500">
                      {' '}
                      — {v.calidad} {formatKilo(v.kilo)}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{v.sku || 'se genera al imprimir'}</td>
                  <td className="px-4 py-2 text-slate-600">{formatCLP(v.price)}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      value={quantities[v.id] ?? ''}
                      onChange={(e) => setQty(v.id, Number(e.target.value))}
                      placeholder="0"
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button className="mt-4" onClick={handlePrint} disabled={selectedVariants.length === 0 || preparing}>
          <Printer size={16} />
          {preparing ? 'Preparando...' : `Imprimir ${labelSheet.length} etiqueta${labelSheet.length === 1 ? '' : 's'}`}
        </Button>
      </div>

      <div id="label-sheet" className="mt-8 flex flex-wrap gap-2">
        {labelSheet.map(({ key, variant, product }) => (
          <div key={key} className="label-card flex flex-col justify-between rounded border border-slate-300">
            <p className="truncate text-[10px] font-semibold leading-tight text-slate-900">{product?.name}</p>
            <p className="text-[9px] leading-tight text-slate-600">
              {variant.calidad} {formatKilo(variant.kilo)}
            </p>
            <BarcodeSvg value={variant.sku || generateSku(variant.id)} />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] text-slate-500">{variant.sku || generateSku(variant.id)}</span>
              <span className="text-xs font-bold text-slate-900">{formatCLP(variant.price)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
