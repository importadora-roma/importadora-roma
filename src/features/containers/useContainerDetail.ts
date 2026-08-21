import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Container, ContainerItem, ContainerTotals, ItemWithProgress, ScanEvent, UnknownCode } from './types'

// Pure — no Supabase dependency — so this is directly unit-testable.
// Undo events carry a negative delta, so summing deltas per item already
// nets out any undone scans without special-casing them here.
export function deriveItemProgress(items: ContainerItem[], events: ScanEvent[]): ItemWithProgress[] {
  const deltaByItem = new Map<string, number>()
  for (const e of events) {
    if (!e.container_item_id) continue
    deltaByItem.set(e.container_item_id, (deltaByItem.get(e.container_item_id) ?? 0) + e.delta)
  }

  return items.map((item) => {
    const scannedQty = deltaByItem.get(item.id) ?? 0
    const remaining = item.expected_qty - scannedQty
    let itemStatus: ItemWithProgress['itemStatus']
    if (scannedQty === 0) itemStatus = 'empty'
    else if (scannedQty > item.expected_qty) itemStatus = 'over'
    else if (scannedQty === item.expected_qty) itemStatus = 'complete'
    else itemStatus = 'partial'
    return { ...item, scannedQty, remaining, itemStatus }
  })
}

export function deriveTotals(itemsWithProgress: ItemWithProgress[], unknownCodes: UnknownCode[]): ContainerTotals {
  const expected = itemsWithProgress.reduce((sum, i) => sum + i.expected_qty, 0)
  const scanned = itemsWithProgress.reduce((sum, i) => sum + i.scannedQty, 0)
  const itemsComplete = itemsWithProgress.filter((i) => i.itemStatus === 'complete').length
  const hasItemMismatch = itemsWithProgress.some((i) => i.itemStatus !== 'complete')
  const hasOver = itemsWithProgress.some((i) => i.itemStatus === 'over')
  const pendingUnknownCount = unknownCodes.filter((u) => u.status === 'pending' || u.status === 'review_later').length

  return {
    expected,
    scanned,
    remaining: expected - scanned,
    percent: expected > 0 ? Math.round((scanned / expected) * 100) : 0,
    itemsComplete,
    itemsTotal: itemsWithProgress.length,
    hasMismatch: hasItemMismatch || pendingUnknownCount > 0,
    hasOver,
    pendingUnknownCount,
  }
}

export function useContainerDetail(containerId: string | null) {
  const [container, setContainer] = useState<Container | null>(null)
  const [items, setItems] = useState<ContainerItem[]>([])
  const [events, setEvents] = useState<ScanEvent[]>([])
  const [unknownCodes, setUnknownCodes] = useState<UnknownCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!containerId) {
      setContainer(null)
      setItems([])
      setEvents([])
      setUnknownCodes([])
      setLoading(false)
      return
    }
    setLoading(true)
    const [containerRes, itemsRes, eventsRes, unknownRes] = await Promise.all([
      supabase.from('containers').select('*').eq('id', containerId).single(),
      supabase
        .from('container_items')
        .select('*')
        .eq('container_id', containerId)
        .is('deleted_at', null)
        .order('created_at'),
      supabase.from('container_scan_events').select('*').eq('container_id', containerId).order('created_at'),
      supabase
        .from('container_unknown_codes')
        .select('*')
        .eq('container_id', containerId)
        .order('created_at', { ascending: false }),
    ])
    const firstError =
      containerRes.error?.message ?? itemsRes.error?.message ?? eventsRes.error?.message ?? unknownRes.error?.message
    if (firstError) {
      setError(firstError)
    } else {
      setContainer(containerRes.data as unknown as Container)
      setItems((itemsRes.data ?? []) as unknown as ContainerItem[])
      setEvents((eventsRes.data ?? []) as unknown as ScanEvent[])
      setUnknownCodes((unknownRes.data ?? []) as unknown as UnknownCode[])
      setError(null)
    }
    setLoading(false)
  }, [containerId])

  useEffect(() => {
    reload()
  }, [reload])

  const itemsWithProgress = deriveItemProgress(items, events)
  const totals = deriveTotals(itemsWithProgress, unknownCodes)

  // Appends a scan/undo event to local state without a full reload — the
  // live counting screen needs to stay fast across hundreds of scans, so it
  // updates optimistically from the record_scan/undo_scan RPC response
  // instead of re-fetching everything after every tap.
  function appendLocalEvent(event: ScanEvent) {
    setEvents((prev) => [...prev, event])
  }

  async function reloadUnknownCodesOnly() {
    if (!containerId) return
    const { data, error } = await supabase
      .from('container_unknown_codes')
      .select('*')
      .eq('container_id', containerId)
      .order('created_at', { ascending: false })
    if (!error) setUnknownCodes((data ?? []) as unknown as UnknownCode[])
  }

  function setContainerStatusLocal(status: Container['status']) {
    setContainer((c) => (c ? { ...c, status } : c))
  }

  return {
    container,
    items,
    itemsWithProgress,
    events,
    unknownCodes,
    totals,
    loading,
    error,
    reload,
    appendLocalEvent,
    reloadUnknownCodesOnly,
    setContainerStatusLocal,
  }
}
