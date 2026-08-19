import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Product, ProductVariant } from '@/types/models'

export function useProducts() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [productsRes, variantsRes] = await Promise.all([
      supabase.from('products').select('*').is('deleted_at', null).order('name'),
      supabase
        .from('product_variants')
        .select('*')
        .is('deleted_at', null)
        .order('calidad')
        .order('kilo'),
    ])
    if (productsRes.error) {
      setError(productsRes.error.message)
    } else if (variantsRes.error) {
      setError(variantsRes.error.message)
    } else {
      setProducts((productsRes.data ?? []) as unknown as Product[])
      setVariants((variantsRes.data ?? []) as unknown as ProductVariant[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function createProduct(input: { name: string; description: string | null; category: string | null }) {
    const { error } = await supabase.from('products').insert(input)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function updateProduct(id: string, input: Partial<Pick<Product, 'name' | 'description' | 'category' | 'active'>>) {
    const { error } = await supabase.from('products').update(input).eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function softDeleteProduct(id: string, reason: string) {
    const { error } = await supabase
      .from('products')
      .update({ active: false, deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function createVariant(input: {
    product_id: string
    calidad: string
    kilo: number
    sku: string | null
    cost: number
    price: number
    supplier: string | null
  }) {
    const { error } = await supabase.from('product_variants').insert(input)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function updateVariant(
    id: string,
    input: Partial<Pick<ProductVariant, 'calidad' | 'kilo' | 'sku' | 'cost' | 'price' | 'supplier' | 'active'>>
  ) {
    const { error } = await supabase.from('product_variants').update(input).eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function softDeleteVariant(id: string, reason: string) {
    const { error } = await supabase
      .from('product_variants')
      .update({ active: false, deleted_at: new Date().toISOString(), deleted_by: userId, delete_reason: reason })
      .eq('id', id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return {
    products,
    variants,
    loading,
    error,
    reload,
    createProduct,
    updateProduct,
    softDeleteProduct,
    createVariant,
    updateVariant,
    softDeleteVariant,
  }
}
