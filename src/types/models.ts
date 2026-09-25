export type UserRole = 'admin' | 'supervisor' | 'vendedor'
export type BranchType = 'importadora' | 'tienda'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  branch_id: string | null
  active: boolean
  commission_pct: number
}

export interface Branch {
  id: string
  name: string
  address: string | null
  phone: string | null
  branch_type: BranchType
  active: boolean
}

export interface Product {
  id: string
  name: string
  description: string | null
  category: string | null
  active: boolean
}

export interface ProductVariant {
  id: string
  product_id: string
  calidad: string
  kilo: number
  sku: string | null
  cost: number
  price: number
  supplier: string | null
  active: boolean
  sort_order: number
}

export interface InventoryRow {
  id: string
  variant_id: string
  branch_id: string
  quantity: number
}
