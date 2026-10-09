import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface TerrenoSale {
  id: string
  sale_number: string | null
  branch_id: string
  user_id: string
  total: number
  sale_date: string
  created_at: string
}

// Every sale tagged "Vendido en terreno" (any branch, any screen it was
// entered from), independent of which branch happens to be selected in the
// topbar — that's what keeps a regular in-store sale from ever showing up
// on the Furgón tab just because an admin left the branch switcher on the
// wrong branch while visiting it.
export function useTerrenoSales(from: string, to: string) {
  const [sales, setSales] = useState<TerrenoSale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sales')
      .select('id, sale_number, branch_id, user_id, total, sale_date, created_at')
      .eq('status', 'completed')
      .eq('is_terreno', true)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setSales((data ?? []) as unknown as TerrenoSale[])
      setError(null)
    }
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    reload()
  }, [reload])

  return { sales, loading, error, reload }
}
