// Hand-written to match supabase/migrations/*.sql exactly.
// If the schema changes, update both the migration and this file together.

export type UserRole = 'admin' | 'supervisor' | 'vendedor'
export type BranchType = 'importadora' | 'tienda'
export type SaleStatus = 'completed' | 'cancelled'
export type SaleItemStatus = 'active' | 'returned' | 'cancelled'
export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia'
// Only the initial sale payment split may include 'credito' (an unpaid
// balance settled later); cash movements and credit installments always
// use a real payment method (PaymentMethod above).
export type SalePaymentMethod = PaymentMethod | 'credito'
export type CashRegisterStatus = 'open' | 'closed'
export type CashMovementType = 'sale_payment' | 'sale_cancel_refund' | 'manual_in' | 'manual_out'
export type TransferStatus = 'en_transito' | 'recibido' | 'cancelado'
export type QuotationStatus = 'pending' | 'converted' | 'expired' | 'cancelled'
export type InventoryMovementType =
  | 'sale'
  | 'sale_cancel'
  | 'purchase'
  | 'transfer_out'
  | 'transfer_in'
  | 'adjustment'
  | 'initial'

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: {
          id: string
          name: string
          address: string | null
          phone: string | null
          branch_type: BranchType
          active: boolean
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          phone?: string | null
          branch_type?: BranchType
          active?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['branches']['Insert']>
        Relationships: []
      }
      users: {
        Row: {
          id: string
          full_name: string
          email: string
          role: UserRole
          branch_id: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          role?: UserRole
          branch_id?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['users']['Insert']>
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          name: string
          rut: string | null
          phone: string | null
          email: string | null
          address: string | null
          notes: string | null
          active: boolean
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          rut?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          notes?: string | null
          active?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
        Relationships: []
      }
      products: {
        Row: {
          id: string
          name: string
          description: string | null
          category: string | null
          active: boolean
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          category?: string | null
          active?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['products']['Insert']>
        Relationships: []
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          calidad: string
          kilo: number
          sku: string | null
          cost: number
          price: number
          supplier: string | null
          active: boolean
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          calidad: string
          kilo: number
          sku?: string | null
          cost?: number
          price?: number
          supplier?: string | null
          active?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Insert']>
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          variant_id: string
          branch_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          id?: string
          variant_id: string
          branch_id: string
          quantity?: number
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['inventory']['Insert']>
        Relationships: []
      }
      inventory_movements: {
        Row: {
          id: string
          variant_id: string
          branch_id: string
          movement_type: InventoryMovementType
          quantity: number
          reference_type: string | null
          reference_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          variant_id: string
          branch_id: string
          movement_type: InventoryMovementType
          quantity: number
          reference_type?: string | null
          reference_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['inventory_movements']['Insert']>
        Relationships: []
      }
      sales: {
        Row: {
          id: string
          sale_number: string | null
          branch_id: string
          customer_id: string | null
          user_id: string
          status: SaleStatus
          subtotal: number
          total: number
          cancel_reason: string | null
          cancelled_by: string | null
          cancelled_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sale_number?: string | null
          branch_id: string
          customer_id?: string | null
          user_id: string
          status?: SaleStatus
          subtotal?: number
          total?: number
          cancel_reason?: string | null
          cancelled_by?: string | null
          cancelled_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['sales']['Insert']>
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          sale_id: string
          variant_id: string
          quantity: number
          original_price: number
          sold_price: number
          cost: number
          line_total: number
          status: SaleItemStatus
          return_reason: string | null
          returned_by: string | null
          returned_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sale_id: string
          variant_id: string
          quantity: number
          original_price: number
          sold_price: number
          cost: number
          line_total: number
          status?: SaleItemStatus
          return_reason?: string | null
          returned_by?: string | null
          returned_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sale_items']['Insert']>
        Relationships: []
      }
      sale_payments: {
        Row: {
          id: string
          sale_id: string
          payment_method: SalePaymentMethod
          amount: number
          created_at: string
        }
        Insert: {
          id?: string
          sale_id: string
          payment_method: SalePaymentMethod
          amount: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sale_payments']['Insert']>
        Relationships: []
      }
      cash_registers: {
        Row: {
          id: string
          branch_id: string
          opened_by: string
          opened_at: string
          opening_amount: number
          closed_by: string | null
          closed_at: string | null
          expected_amount: number | null
          actual_amount: number | null
          difference: number | null
          status: CashRegisterStatus
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          branch_id: string
          opened_by: string
          opened_at?: string
          opening_amount?: number
          closed_by?: string | null
          closed_at?: string | null
          expected_amount?: number | null
          actual_amount?: number | null
          difference?: number | null
          status?: CashRegisterStatus
          notes?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['cash_registers']['Insert']>
        Relationships: []
      }
      cash_movements: {
        Row: {
          id: string
          cash_register_id: string
          branch_id: string
          movement_type: CashMovementType
          category: string | null
          amount: number
          reference_type: string | null
          reference_id: string | null
          description: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          cash_register_id: string
          branch_id: string
          movement_type: CashMovementType
          category?: string | null
          amount: number
          reference_type?: string | null
          reference_id?: string | null
          description?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['cash_movements']['Insert']>
        Relationships: []
      }
      transfers: {
        Row: {
          id: string
          transfer_number: string | null
          origin_branch_id: string
          destination_branch_id: string
          status: TransferStatus
          sent_by: string
          sent_at: string
          received_by: string | null
          received_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          transfer_number?: string | null
          origin_branch_id: string
          destination_branch_id: string
          status?: TransferStatus
          sent_by: string
          sent_at?: string
          received_by?: string | null
          received_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['transfers']['Insert']>
        Relationships: []
      }
      transfer_items: {
        Row: {
          id: string
          transfer_id: string
          variant_id: string
          quantity: number
        }
        Insert: {
          id?: string
          transfer_id: string
          variant_id: string
          quantity: number
        }
        Update: Partial<Database['public']['Tables']['transfer_items']['Insert']>
        Relationships: []
      }
      quotations: {
        Row: {
          id: string
          quotation_number: string | null
          branch_id: string
          customer_id: string | null
          user_id: string
          status: QuotationStatus
          subtotal: number
          total: number
          valid_until: string | null
          converted_sale_id: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quotation_number?: string | null
          branch_id: string
          customer_id?: string | null
          user_id: string
          status?: QuotationStatus
          subtotal?: number
          total?: number
          valid_until?: string | null
          converted_sale_id?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['quotations']['Insert']>
        Relationships: []
      }
      quotation_items: {
        Row: {
          id: string
          quotation_id: string
          variant_id: string
          quantity: number
          unit_price: number
          line_total: number
        }
        Insert: {
          id?: string
          quotation_id: string
          variant_id: string
          quantity: number
          unit_price: number
          line_total: number
        }
        Update: Partial<Database['public']['Tables']['quotation_items']['Insert']>
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          table_name: string | null
          record_id: string | null
          old_data: Record<string, unknown> | null
          new_data: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          table_name?: string | null
          record_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>
        Relationships: []
      }
      sale_credit_payments: {
        Row: {
          id: string
          sale_id: string
          amount: number
          payment_method: PaymentMethod
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sale_id: string
          amount: number
          payment_method: PaymentMethod
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['sale_credit_payments']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      create_sale: {
        Args: {
          p_branch_id: string
          p_customer_id: string | null
          p_items: { variant_id: string; quantity: number; sold_price: number }[]
          p_payments: { payment_method: SalePaymentMethod; amount: number }[]
          p_notes?: string | null
        }
        Returns: string
      }
      record_credit_payment: {
        Args: {
          p_sale_id: string
          p_amount: number
          p_payment_method: PaymentMethod
          p_notes?: string | null
        }
        Returns: string
      }
      cancel_sale: {
        Args: { p_sale_id: string; p_reason: string }
        Returns: undefined
      }
      exchange_sale_item: {
        Args: {
          p_sale_item_id: string
          p_new_variant_id: string
          p_new_quantity: number
          p_reason: string
          p_additional_payments?: { payment_method: PaymentMethod; amount: number }[] | null
        }
        Returns: string
      }
      create_transfer: {
        Args: {
          p_origin_branch_id: string
          p_destination_branch_id: string
          p_items: { variant_id: string; quantity: number }[]
          p_notes?: string | null
        }
        Returns: string
      }
      receive_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      convert_quotation_to_sale: {
        Args: { p_quotation_id: string; p_payments: { payment_method: SalePaymentMethod; amount: number }[] }
        Returns: string
      }
      open_cash_register: {
        Args: { p_branch_id: string; p_opening_amount: number }
        Returns: string
      }
      close_cash_register: {
        Args: { p_cash_register_id: string; p_actual_amount: number }
        Returns: undefined
      }
      add_manual_cash_movement: {
        Args: {
          p_cash_register_id: string
          p_movement_type: 'manual_in' | 'manual_out'
          p_category: string
          p_amount: number
          p_description?: string | null
        }
        Returns: string
      }
      adjust_inventory: {
        Args: {
          p_variant_id: string
          p_branch_id: string
          p_new_quantity: number
          p_reason?: string | null
        }
        Returns: undefined
      }
    }
  }
}
