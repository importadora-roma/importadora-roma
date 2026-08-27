import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface CalidadCostDefault {
  calidad: string
  default_cost: number
}

export function useCalidadCostDefaults() {
  const [defaults, setDefaults] = useState<CalidadCostDefault[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('calidad_cost_defaults').select('calidad, default_cost').order('calidad')
    if (error) {
      setError(error.message)
    } else {
      setDefaults((data ?? []) as CalidadCostDefault[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function upsertDefault(calidad: string, defaultCost: number) {
    const { error } = await supabase.from('calidad_cost_defaults').upsert({ calidad, default_cost: defaultCost })
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  async function deleteDefault(calidad: string) {
    const { error } = await supabase.from('calidad_cost_defaults').delete().eq('calidad', calidad)
    if (error) return { error: error.message }
    await reload()
    return { error: null }
  }

  return { defaults, loading, error, reload, upsertDefault, deleteDefault }
}
