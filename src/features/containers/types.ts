import type {
  ContainerItemSource,
  ContainerLanguage,
  ContainerStatus,
  ScanEventType,
  ScanMatchStatus,
  ScanMethod,
  UnknownCodeStatus,
} from '@/types/database'

export interface Container {
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
  reopen_count: number
  pushed_to_inventory_at: string | null
  created_at: string
  updated_at: string
}

export interface ContainerItem {
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
  cost_usd_per_kilo: number | null
  pushed_to_inventory_at: string | null
  created_at: string
}

export interface ScanEvent {
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
  match_status: ScanMatchStatus
  client_event_id: string
  created_by: string
  created_at: string
}

export interface UnknownCode {
  id: string
  container_id: string
  code_normalized: string
  first_raw_code: string
  scan_count: number
  status: UnknownCodeStatus
  resolved_container_item_id: string | null
  resolution_notes: string | null
  created_at: string
}

export interface ProductCode {
  id: string
  code: string
  code_normalized: string
  product_name: string
  calidad: string | null
  default_unit: string | null
  supplier: string | null
  times_seen: number
  created_at: string
}

export interface ContainerSettings {
  id: string
  branch_id: string | null
  ocr_confidence_threshold: number
  duplicate_scan_window_ms: number
  photo_archive_enabled: boolean
  default_language: ContainerLanguage
  block_over_scan: boolean
  usd_clp_rate: number
  operational_markup_pct: number
  cost_rounding: number
}

// One expected item plus its scan progress, derived client-side from
// container_items + container_scan_events (see deriveItemProgress in
// useContainerDetail.ts).
export type ItemProgressStatus = 'empty' | 'partial' | 'complete' | 'over'

export interface ItemWithProgress extends ContainerItem {
  scannedQty: number
  remaining: number
  itemStatus: ItemProgressStatus
}

export interface ContainerTotals {
  expected: number
  scanned: number
  remaining: number
  percent: number
  itemsComplete: number
  itemsTotal: number
  hasMismatch: boolean
  hasOver: boolean
  pendingUnknownCount: number
}
