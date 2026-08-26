import { useMemo } from 'react'
import { useReports } from './useReports'
import { useUsers } from '@/features/users/useUsers'

export interface CommissionRow {
  userId: string
  userName: string
  commissionPct: number
  salesCount: number
  revenue: number
  commission: number
}

// Commission is computed on revenue (sale.total), using each rep's
// commission_pct set in Configuración > Usuarios — not on margin, since
// reps don't control landed cost and shouldn't be penalized when it changes.
export function useCommissionReport(branchId: string, from: string, to: string) {
  const { sales, loading: loadingSales } = useReports(branchId, from, to)
  const { users, loading: loadingUsers } = useUsers()

  const rows = useMemo<CommissionRow[]>(() => {
    const userById = new Map(users.map((u) => [u.id, u]))
    const byUser = new Map<string, { salesCount: number; revenue: number }>()
    for (const sale of sales) {
      const entry = byUser.get(sale.user_id) ?? { salesCount: 0, revenue: 0 }
      entry.salesCount += 1
      entry.revenue += sale.total
      byUser.set(sale.user_id, entry)
    }
    return Array.from(byUser.entries())
      .map(([userId, agg]) => {
        const user = userById.get(userId)
        const commissionPct = user?.commission_pct ?? 0
        return {
          userId,
          userName: user?.full_name ?? 'Usuario eliminado',
          commissionPct,
          salesCount: agg.salesCount,
          revenue: agg.revenue,
          commission: agg.revenue * (commissionPct / 100),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [sales, users])

  return { rows, loading: loadingSales || loadingUsers }
}
