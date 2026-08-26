import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface AlertSettings {
  id: string
  low_stock_threshold: number
  credit_default_term_days: number
}

const FALLBACK: AlertSettings = { id: '', low_stock_threshold: 5, credit_default_term_days: 30 }

// Single global row (branch_id null), same v1 scope as container_settings.
export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings>(FALLBACK)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('alert_settings').select('*').is('branch_id', null).maybeSingle()
    setSettings((data as unknown as AlertSettings) ?? FALLBACK)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function updateSettings(input: Partial<Pick<AlertSettings, 'low_stock_threshold' | 'credit_default_term_days'>>) {
    if (!settings.id) return { error: 'Configuración no cargada' }
    const { error } = await supabase.from('alert_settings').update(input).eq('id', settings.id)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { settings, loading, reload, updateSettings }
}
