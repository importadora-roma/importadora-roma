import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { supabase } from '@/lib/supabase'
import type { ScanMethod } from '@/types/database'

export interface PendingScan {
  kind: 'scan'
  clientEventId: string
  containerId: string
  codeRaw: string
  method: ScanMethod
  delta: number
  confidence: number | null
  corrected: boolean
  confirmOver: boolean
  deviceInfo: Record<string, unknown> | null
  clientScannedAt: string
  photoBlob: Blob | null
  queuedAt: number
}

export interface PendingUndo {
  kind: 'undo'
  clientEventId: string
  scanEventId: string
  reason: string | null
  queuedAt: number
}

export type PendingItem = PendingScan | PendingUndo

interface QueueDB extends DBSchema {
  pending: {
    key: string
    value: PendingItem
  }
}

let dbPromise: Promise<IDBPDatabase<QueueDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<QueueDB>('roma-container-offline-queue', 1, {
      upgrade(db) {
        db.createObjectStore('pending', { keyPath: 'clientEventId' })
      },
    })
  }
  return dbPromise
}

export async function enqueueScan(item: Omit<PendingScan, 'kind' | 'queuedAt'>) {
  const db = await getDb()
  await db.put('pending', { ...item, kind: 'scan', queuedAt: Date.now() })
}

export async function enqueueUndo(item: Omit<PendingUndo, 'kind' | 'queuedAt'>) {
  const db = await getDb()
  await db.put('pending', { ...item, kind: 'undo', queuedAt: Date.now() })
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb()
  return db.count('pending')
}

export async function getAllPending(): Promise<PendingItem[]> {
  const db = await getDb()
  const items = await db.getAll('pending')
  return items.sort((a, b) => a.queuedAt - b.queuedAt)
}

async function removePending(clientEventId: string) {
  const db = await getDb()
  await db.delete('pending', clientEventId)
}

// A network-level failure (offline, DNS, timeout) surfaces very differently
// from a normal Postgres/RLS rejection through supabase-js — the latter
// still has a proper Postgrest error shape, the former looks like a raw
// fetch TypeError. Used to decide "queue this" vs "show the real error".
export function isNetworkError(message: string | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')
}

export interface FlushSummary {
  synced: number
  failed: number
}

// Replays every queued scan/undo against the real RPCs, in the order they
// were captured. client_event_id is what makes this safe to call multiple
// times (a browser close/reopen, a flaky connection retried mid-flush) —
// the server-side unique index means a replayed item can never double-count.
export async function flushQueue(): Promise<FlushSummary> {
  const items = await getAllPending()
  let synced = 0
  let failed = 0

  for (const item of items) {
    try {
      if (item.kind === 'scan') {
        let photoPath: string | null = null
        if (item.photoBlob) {
          const path = `${item.containerId}/${item.clientEventId}.jpg`
          const { error: uploadError } = await supabase.storage
            .from('container-photos')
            .upload(path, item.photoBlob, { contentType: 'image/jpeg' })
          if (!uploadError) photoPath = path
        }

        const { error } = await supabase.rpc('record_scan', {
          p_container_id: item.containerId,
          p_client_event_id: item.clientEventId,
          p_code_raw: item.codeRaw,
          p_method: item.method,
          p_delta: item.delta,
          p_confidence: item.confidence,
          p_corrected: item.corrected,
          p_photo_path: photoPath,
          p_device_info: item.deviceInfo,
          p_client_scanned_at: item.clientScannedAt,
          p_confirm_over: item.confirmOver,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('undo_scan', {
          p_scan_event_id: item.scanEventId,
          p_client_event_id: item.clientEventId,
          p_reason: item.reason,
        })
        if (error) throw error
      }

      await removePending(item.clientEventId)
      synced += 1
    } catch (err) {
      // A genuine rejection (e.g. a concurrent scan on another device pushed
      // this same item over its expected quantity in the meantime) is left
      // in the queue rather than silently dropped or force-accepted — it
      // needs a person to look at it, not an automatic retry loop.
      if (isNetworkError(err instanceof Error ? err.message : String(err))) {
        break // connection dropped again mid-flush; stop and try later
      }
      failed += 1
    }
  }

  return { synced, failed }
}
