import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { formatCLP, formatKilo } from '@/lib/format'
import { useProducts } from './useProducts'
import type { Product, ProductVariant } from '@/types/models'

interface ProductForm {
  name: string
  description: string
  category: string
}

interface VariantForm {
  calidad: string
  kilo: string
  sku: string
  cost: string
  price: string
  supplier: string
}

const emptyProductForm: ProductForm = { name: '', description: '', category: '' }
const emptyVariantForm: VariantForm = { calidad: '', kilo: '', sku: '', cost: '', price: '', supplier: '' }

export function ProductsPage() {
  const {
    products,
    variants,
    loading,
    error,
    createProduct,
    updateProduct,
    softDeleteProduct,
    createVariant,
    updateVariant,
    softDeleteVariant,
  } = useProducts()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm)
  const [productFormError, setProductFormError] = useState<string | null>(null)

  const [variantModalOpen, setVariantModalOpen] = useState(false)
  const [variantProductId, setVariantProductId] = useState<string | null>(null)
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null)
  const [variantForm, setVariantForm] = useState<VariantForm>(emptyVariantForm)
  const [variantFormError, setVariantFormError] = useState<string | null>(null)

  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null)
  const [deleteVariantTarget, setDeleteVariantTarget] = useState<ProductVariant | null>(null)
  const [saving, setSaving] = useState(false)

  function toggleExpand(productId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function openCreateProduct() {
    setEditingProduct(null)
    setProductForm(emptyProductForm)
    setProductFormError(null)
    setProductModalOpen(true)
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product)
    setProductForm({ name: product.name, description: product.description ?? '', category: product.category ?? '' })
    setProductFormError(null)
    setProductModalOpen(true)
  }

  async function handleSaveProduct() {
    if (!productForm.name.trim()) {
      setProductFormError('El nombre es obligatorio')
      return
    }
    setSaving(true)
    const payload = {
      name: productForm.name.trim(),
      description: productForm.description.trim() || null,
      category: productForm.category.trim() || null,
    }
    const { error } = editingProduct ? await updateProduct(editingProduct.id, payload) : await createProduct(payload)
    setSaving(false)
    if (error) {
      setProductFormError(error)
      return
    }
    setProductModalOpen(false)
  }

  function openCreateVariant(productId: string) {
    setVariantProductId(productId)
    setEditingVariant(null)
    setVariantForm(emptyVariantForm)
    setVariantFormError(null)
    setVariantModalOpen(true)
  }

  function openEditVariant(variant: ProductVariant) {
    setVariantProductId(variant.product_id)
    setEditingVariant(variant)
    setVariantForm({
      calidad: variant.calidad,
      kilo: String(variant.kilo),
      sku: variant.sku ?? '',
      cost: String(variant.cost),
      price: String(variant.price),
      supplier: variant.supplier ?? '',
    })
    setVariantFormError(null)
    setVariantModalOpen(true)
  }

  async function handleSaveVariant() {
    const kilo = Number(variantForm.kilo)
    const cost = Number(variantForm.cost)
    const price = Number(variantForm.price)

    if (!variantForm.calidad.trim()) {
      setVariantFormError('La calidad es obligatoria')
      return
    }
    if (!kilo || kilo <= 0) {
      setVariantFormError('El kilo debe ser mayor a 0')
      return
    }
    if (Number.isNaN(cost) || cost < 0 || Number.isNaN(price) || price < 0) {
      setVariantFormError('Costo y precio deben ser números válidos')
      return
    }

    setSaving(true)
    const payload = {
      calidad: variantForm.calidad.trim(),
      kilo,
      sku: variantForm.sku.trim() || null,
      cost,
      price,
      supplier: variantForm.supplier.trim() || null,
    }
    const { error } = editingVariant
      ? await updateVariant(editingVariant.id, payload)
      : await createVariant({ ...payload, product_id: variantProductId! })
    setSaving(false)
    if (error) {
      setVariantFormError(error)
      return
    }
    setVariantModalOpen(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Productos</h1>
          <p className="mt-1 text-sm text-slate-500">Gestiona productos y sus variantes (calidad x kilo).</p>
        </div>
        <Button onClick={openCreateProduct}>
          <Plus size={16} />
          Nuevo producto
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-8 px-4 py-3" />
              <th className="px-4 py-3">Producto</th>
              <th className="px-4 py-3">Categoría</th>
              <th className="px-4 py-3">Variantes</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No hay productos registrados todavía.
                </td>
              </tr>
            )}
            {products.map((product) => {
              const productVariants = variants.filter((v) => v.product_id === product.id)
              const isExpanded = expanded.has(product.id)
              return (
                <Fragment key={product.id}>
                  <tr>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleExpand(product.id)} className="text-slate-400 hover:text-slate-700">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{product.name}</td>
                    <td className="px-4 py-3 text-slate-600">{product.category || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{productVariants.length}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          product.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {product.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEditProduct(product)} className="text-slate-400 hover:text-slate-700">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleteProductTarget(product)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-4 py-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase text-slate-500">Variantes (calidad x kilo)</p>
                          <Button variant="secondary" onClick={() => openCreateVariant(product.id)}>
                            <Plus size={14} />
                            Nueva variante
                          </Button>
                        </div>
                        <table className="mt-3 w-full text-left text-sm">
                          <thead className="text-xs uppercase text-slate-400">
                            <tr>
                              <th className="py-2 pr-4">Calidad</th>
                              <th className="py-2 pr-4">Kilo</th>
                              <th className="py-2 pr-4">SKU</th>
                              <th className="py-2 pr-4">Proveedor</th>
                              <th className="py-2 pr-4">Costo</th>
                              <th className="py-2 pr-4">Precio</th>
                              <th className="py-2 pr-4">Estado</th>
                              <th className="py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {productVariants.length === 0 && (
                              <tr>
                                <td colSpan={8} className="py-3 text-slate-400">
                                  Sin variantes todavía.
                                </td>
                              </tr>
                            )}
                            {productVariants.map((variant) => (
                              <tr key={variant.id}>
                                <td className="py-2 pr-4">{variant.calidad}</td>
                                <td className="py-2 pr-4">{formatKilo(variant.kilo)}</td>
                                <td className="py-2 pr-4 text-slate-500">{variant.sku || '—'}</td>
                                <td className="py-2 pr-4 text-slate-500">{variant.supplier || '—'}</td>
                                <td className="py-2 pr-4">{formatCLP(variant.cost)}</td>
                                <td className="py-2 pr-4">{formatCLP(variant.price)}</td>
                                <td className="py-2 pr-4">
                                  <span
                                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                                      variant.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    {variant.active ? 'Activa' : 'Inactiva'}
                                  </span>
                                </td>
                                <td className="py-2">
                                  <div className="flex justify-end gap-3">
                                    <button onClick={() => openEditVariant(variant)} className="text-slate-400 hover:text-slate-700">
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      onClick={() => setDeleteVariantTarget(variant)}
                                      className="text-slate-400 hover:text-red-600"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={productModalOpen} onClose={() => setProductModalOpen(false)} title={editingProduct ? 'Editar producto' : 'Nuevo producto'}>
        <div className="space-y-4">
          <Input
            label="Nombre"
            value={productForm.name}
            onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
            placeholder="Ej: Poleras algodón"
          />
          <Input
            label="Categoría"
            value={productForm.category}
            onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
          />
          <Textarea
            label="Descripción"
            value={productForm.description}
            onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
            rows={2}
          />
          {productFormError && <p className="text-sm text-red-600">{productFormError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setProductModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveProduct} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={variantModalOpen} onClose={() => setVariantModalOpen(false)} title={editingVariant ? 'Editar variante' : 'Nueva variante'}>
        <div className="space-y-4">
          <Select
            label="Calidad"
            value={variantForm.calidad}
            onChange={(e) => setVariantForm({ ...variantForm, calidad: e.target.value })}
          >
            <option value="">Selecciona...</option>
            <option value="Primera">Primera</option>
            <option value="Segunda">Segunda</option>
            <option value="Tercera">Tercera</option>
            {variantForm.calidad && !['Primera', 'Segunda', 'Tercera'].includes(variantForm.calidad) && (
              <option value={variantForm.calidad}>{variantForm.calidad}</option>
            )}
            <option value="__custom__">Otra (escribir abajo)</option>
          </Select>
          {variantForm.calidad === '__custom__' && (
            <Input
              label="Calidad personalizada"
              onChange={(e) => setVariantForm({ ...variantForm, calidad: e.target.value })}
              placeholder="Ej: Cuarta"
            />
          )}
          <Input
            label="Kilo"
            type="number"
            step="0.01"
            value={variantForm.kilo}
            onChange={(e) => setVariantForm({ ...variantForm, kilo: e.target.value })}
            placeholder="Ej: 20"
          />
          <Input label="SKU (opcional)" value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} />
          <Input
            label="Proveedor (opcional)"
            value={variantForm.supplier}
            onChange={(e) => setVariantForm({ ...variantForm, supplier: e.target.value })}
          />
          <Input
            label="Costo"
            type="number"
            value={variantForm.cost}
            onChange={(e) => setVariantForm({ ...variantForm, cost: e.target.value })}
          />
          <Input
            label="Precio"
            type="number"
            value={variantForm.price}
            onChange={(e) => setVariantForm({ ...variantForm, price: e.target.value })}
          />
          {variantFormError && <p className="text-sm text-red-600">{variantFormError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setVariantModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveVariant} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={!!deleteProductTarget}
        onClose={() => setDeleteProductTarget(null)}
        title={`Eliminar "${deleteProductTarget?.name}"`}
        confirmLabel="Eliminar"
        onConfirm={(reason) => softDeleteProduct(deleteProductTarget!.id, reason)}
      />
      <ReasonModal
        open={!!deleteVariantTarget}
        onClose={() => setDeleteVariantTarget(null)}
        title={`Eliminar variante "${deleteVariantTarget?.calidad} ${deleteVariantTarget ? formatKilo(deleteVariantTarget.kilo) : ''}"`}
        confirmLabel="Eliminar"
        onConfirm={(reason) => softDeleteVariant(deleteVariantTarget!.id, reason)}
      />
    </div>
  )
}
