import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ContainerSettings } from './types'

const FALLBACK: ContainerSettings = {
  id: '',
  branch_id: null,
  ocr_confidence_threshold: 70,
  duplicate_scan_window_ms: 500,
  photo_archive_enabled: false,
  default_language: 'es',
  block_over_scan: true,
}

// Resolves effective settings as branch-specific row ?? global row ??
// hardcoded fallback, so scanning works correctly even before an admin has
// ever opened the settings screen.
export function useContainerSettings(branchId?: string | null) {
  const [settings, setSettings] = useState<ContainerSettings>(FALLBACK)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    let row: ContainerSettings | null = null
    if (branchId) {
      const { data } = await supabase.from('container_settings').select('*').eq('branch_id', branchId).maybeSingle()
      if (data) row = data as unknown as ContainerSettings
    }
    if (!row) {
      const { data } = await supabase.from('container_settings').select('*').is('branch_id', null).maybeSingle()
      if (data) row = data as unknown as ContainerSettings
    }
    setSettings(row ?? FALLBACK)
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    reload()
  }, [reload])

  async function updateSettings(
    input: Partial<
      Pick<
        ContainerSettings,
        'ocr_confidence_threshold' | 'duplicate_scan_window_ms' | 'photo_archive_enabled' | 'default_language' | 'block_over_scan'
      >
    >
  ) {
    if (!settings.id) return { error: 'Configuración no cargada' }
    const { error } = await supabase.from('container_settings').update(input).eq('id', settings.id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { settings, loading, reload, updateSettings }
}
