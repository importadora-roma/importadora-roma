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

// Contenedores module
export type ContainerStatus = 'draft' | 'importing' | 'counting' | 'completed'
export type ContainerItemSource = 'import' | 'manual' | 'added_during_count'
export type ScanEventType = 'scan' | 'undo'
export type ScanMethod = 'barcode' | 'manual' | 'ocr' | 'usb_scanner'
export type ScanMatchStatus = 'matched' | 'unknown' | 'over'
export type UnknownCodeStatus = 'pending' | 'added_to_list' | 'manually_matched' | 'ignored' | 'review_later'
export type ContainerLanguage = 'es' | 'tr'
export type InvoiceStatus = 'pending' | 'issued' | 'cancelled'

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
          requires_invoice: boolean
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
          requires_invoice?: boolean
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
      invoices: {
        Row: {
          id: string
          internal_number: string | null
          sale_id: string
          branch_id: string
          status: InvoiceStatus
          sii_folio: string | null
          notes: string | null
          issued_at: string | null
          issued_by: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancel_reason: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          internal_number?: string | null
          sale_id: string
          branch_id: string
          status?: InvoiceStatus
          sii_folio?: string | null
          notes?: string | null
          issued_at?: string | null
          issued_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancel_reason?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
        Relationships: []
      }
      containers: {
        Row: {
          id: string
          internal_number: string | null
          code: string
          branch_id: string
          supplier: string | null
          arrival_date: string | null
          status: ContainerStatus
          notes: string | null
          created_by: string | null
          completed_at: string | null
          completed_by: string | null
          reopened_at: string | null
          reopened_by: string | null
          reopen_count: number
          pushed_to_inventory_at: string | null
          pushed_to_inventory_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          internal_number?: string | null
          code: string
          branch_id: string
          supplier?: string | null
          arrival_date?: string | null
          status?: ContainerStatus
          notes?: string | null
          created_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reopen_count?: number
          pushed_to_inventory_at?: string | null
          pushed_to_inventory_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['containers']['Insert']>
        Relationships: []
      }
      container_items: {
        Row: {
          id: string
          container_id: string
          code: string | null
          code_normalized: string | null
          product_name: string
          calidad: string | null
          expected_qty: number
          unit: string
          notes: string | null
          source: ContainerItemSource
          variant_id: string | null
          mapped_at: string | null
          mapped_by: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          container_id: string
          code?: string | null
          product_name: string
          calidad?: string | null
          expected_qty: number
          unit?: string
          notes?: string | null
          source?: ContainerItemSource
          variant_id?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['container_items']['Insert']>
        Relationships: []
      }
      product_codes: {
        Row: {
          id: string
          code: string
          code_normalized: string
          product_name: string
          calidad: string | null
          default_unit: string | null
          supplier: string | null
          last_seen_container_id: string | null
          times_seen: number
          active: boolean
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delete_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          product_name: string
          calidad?: string | null
          default_unit?: string | null
          supplier?: string | null
          last_seen_container_id?: string | null
          times_seen?: number
          active?: boolean
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['product_codes']['Insert']>
        Relationships: []
      }
      container_scan_events: {
        Row: {
          id: string
          container_id: string
          container_item_id: string | null
          code_raw: string
          code_normalized: string
          event_type: ScanEventType
          delta: number
          undoes_event_id: string | null
          method: ScanMethod
          confidence: number | null
          corrected: boolean
          photo_path: string | null
          device_info: Record<string, unknown> | null
          match_status: ScanMatchStatus
          client_event_id: string
          client_scanned_at: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          container_id: string
          container_item_id?: string | null
          code_raw: string
          code_normalized: string
          event_type: ScanEventType
          delta: number
          undoes_event_id?: string | null
          method: ScanMethod
          confidence?: number | null
          corrected?: boolean
          photo_path?: string | null
          device_info?: Record<string, unknown> | null
          match_status: ScanMatchStatus
          client_event_id: string
          client_scanned_at?: string | null
          created_by: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['container_scan_events']['Insert']>
        Relationships: []
      }
      container_unknown_codes: {
        Row: {
          id: string
          container_id: string
          code_normalized: string
          first_raw_code: string
          first_seen_scan_event_id: string | null
          scan_count: number
          status: UnknownCodeStatus
          resolved_container_item_id: string | null
          resolution_notes: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          container_id: string
          code_normalized: string
          first_raw_code: string
          first_seen_scan_event_id?: string | null
          scan_count?: number
          status?: UnknownCodeStatus
          resolved_container_item_id?: string | null
          resolution_notes?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['container_unknown_codes']['Insert']>
        Relationships: []
      }
      container_settings: {
        Row: {
          id: string
          branch_id: string | null
          ocr_confidence_threshold: number
          duplicate_scan_window_ms: number
          photo_archive_enabled: boolean
          default_language: ContainerLanguage
          block_over_scan: boolean
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          branch_id?: string | null
          ocr_confidence_threshold?: number
          duplicate_scan_window_ms?: number
          photo_archive_enabled?: boolean
          default_language?: ContainerLanguage
          block_over_scan?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['container_settings']['Insert']>
        Relationships: []
      }
    }
    Views: {
      container_summary: {
        Row: {
          container_id: string
          expected_qty: number
          scanned_qty: number
          items_total: number
          items_complete: number
          pending_unknown_count: number
        }
        Relationships: []
      }
      invoice_queue: {
        Row: {
          invoice_id: string
          internal_number: string | null
          sale_id: string
          branch_id: string
          status: InvoiceStatus
          sii_folio: string | null
          notes: string | null
          issued_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          created_at: string
          sale_number: string | null
          gross_total: number
          net_total: number
          iva_total: number
          customer_id: string | null
          customer_name: string | null
          customer_rut: string | null
        }
        Relationships: []
      }
    }
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
      import_container_items: {
        Args: {
          p_container_id: string
          p_items: {
            code?: string | null
            product_name: string
            calidad?: string | null
            expected_qty: number
            unit?: string | null
            notes?: string | null
          }[]
        }
        Returns: { inserted: number; merged: number }
      }
      set_container_status: {
        Args: {
          p_container_id: string
          p_new_status: ContainerStatus
          p_override_mismatch?: boolean
          p_reason?: string | null
        }
        Returns: undefined
      }
      record_scan: {
        Args: {
          p_container_id: string
          p_client_event_id: string
          p_code_raw: string
          p_method: ScanMethod
          p_delta?: number
          p_confidence?: number | null
          p_corrected?: boolean
          p_photo_path?: string | null
          p_device_info?: Record<string, unknown> | null
          p_client_scanned_at?: string | null
          p_confirm_over?: boolean
        }
        Returns: {
          event_id: string
          match_status: ScanMatchStatus
          container_item_id: string | null
          code_normalized: string
          scanned_qty_for_item: number | null
          expected_qty_for_item: number | null
          already_recorded: boolean
        }
      }
      undo_scan: {
        Args: {
          p_scan_event_id: string
          p_client_event_id?: string | null
          p_reason?: string | null
        }
        Returns: string
      }
      resolve_unknown_code: {
        Args: {
          p_container_id: string
          p_code_normalized: string
          p_action: 'add_to_list' | 'manual_match' | 'ignore' | 'review_later'
          p_product_name?: string | null
          p_calidad?: string | null
          p_expected_qty?: number | null
          p_matched_item_id?: string | null
          p_notes?: string | null
        }
        Returns: { unknown_code_id: string; container_item_id: string | null; action: string; learned_code: boolean }
      }
      push_container_to_inventory: {
        Args: {
          p_container_id: string
          p_variant_mappings?: { container_item_id: string; variant_id: string }[] | null
        }
        Returns: { itemsPushed: number; itemsSkippedUnmapped: number }
      }
      set_sale_requires_invoice: {
        Args: { p_sale_id: string; p_requires: boolean }
        Returns: string
      }
      issue_invoice: {
        Args: { p_invoice_id: string; p_sii_folio?: string | null }
        Returns: undefined
      }
      cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
    }
  }
}
