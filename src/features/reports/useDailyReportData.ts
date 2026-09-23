import { useMemo } from 'react'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { useCustomers } from '@/features/customers/useCustomers'
import { useExpenses } from '@/features/expenses/useExpenses'
import { useTransferValue } from '@/features/transfers/useTransferValue'
import { useReports } from './useReports'
import { useProfitReport } from './useProfitReport'
import { useProductProfitReport } from './useProductProfitReport'
import { useCommissionReport } from './useCommissionReport'
import type { DailyReportData } from './dailyPdf'

// Everything the daily PDF prints, for one branch (or all, when branchId is
// empty) and one day — composed from the same hooks the on-screen reports use
// so the PDF can never disagree with the numbers next to its button.
export function useDailyReportData(branchId: string, day: string): { data: DailyReportData; loading: boolean } {
  const { branches } = useEffectiveBranch()
  const { customers } = useCustomers()
  const { sales, payments, loading: loadingSales } = useReports(branchId, day, day)
  const { cogs, grossMargin, loading: loadingProfit } = useProfitReport(branchId, day, day)
  const { rows: productRows, loading: loadingProducts } = useProductProfitReport(branchId, day, day)
  const { rows: commissionRows } = useCommissionReport(branchId, day, day)
  const { expenses, loading: loadingExpenses } = useExpenses(branchId, day, day)
  const { total: transferValue, transferCount, loading: loadingTransfers } = useTransferValue(branchId, day, day)

  const branch = branchId ? branches.find((b) => b.id === branchId) : null
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])

  return {
    data: {
      day,
      branchId,
      branchName: branch?.name ?? 'Todas las sucursales',
      branchAddress: branch?.address ?? null,
      sales,
      payments,
      productRows,
      commissionRows,
      expenses,
      cogs,
      grossMargin,
      transferValue,
      transferCount,
      customerNameById,
    },
    loading: loadingSales || loadingProfit || loadingProducts || loadingExpenses || loadingTransfers,
  }
}
