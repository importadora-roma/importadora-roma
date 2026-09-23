import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useDailyReportData } from './useDailyReportData'
import { generateDailyPdf, type DailyPdfMode } from './dailyPdf'

// The two daily PDFs: "sade" (clear at a glance, no costs/margins) and
// "detallado" (adds cost, margin, profit, commissions). Used from the Panel
// (today) and from Reportes (any chosen day).
export function DailyReportButtons({ branchId, day }: { branchId: string; day: string }) {
  const { data, loading } = useDailyReportData(branchId, day)
  const [busy, setBusy] = useState<DailyPdfMode | null>(null)

  async function download(mode: DailyPdfMode) {
    setBusy(mode)
    try {
      await generateDailyPdf(data, mode)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => download('simple')} disabled={loading || busy !== null}>
        <FileText size={16} />
        {busy === 'simple' ? 'Generando...' : 'Reporte diario'}
      </Button>
      <Button variant="secondary" onClick={() => download('detailed')} disabled={loading || busy !== null}>
        <FileText size={16} />
        {busy === 'detailed' ? 'Generando...' : 'Reporte diario (detallado)'}
      </Button>
    </div>
  )
}
