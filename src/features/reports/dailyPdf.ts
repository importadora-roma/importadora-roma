import { createPdfDoc, autoTable, getLogoDataUrl, addPieChartWithLegend, BRAND_NAVY } from '@/lib/pdf'
import { formatCLP, formatDate, todayCL } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { ReportSale } from './useReports'
import type { ProductProfitRow } from './useProductProfitReport'
import type { CommissionRow } from './useCommissionReport'
import type { Expense } from '@/features/expenses/useExpenses'
import type { ExpenseCategory } from '@/types/database'

export type DailyPdfMode = 'simple' | 'detailed'

export interface DailyReportData {
  day: string
  branchId: string
  branchName: string
  branchAddress: string | null
  sales: ReportSale[]
  payments: { payment_method: string; amount: number }[]
  productRows: ProductProfitRow[]
  commissionRows: CommissionRow[]
  expenses: Expense[]
  cogs: number
  grossMargin: number
  transferValue: number
  transferCount: number
  customerNameById: Map<string, string>
}

const expenseLabels: Record<ExpenseCategory, string> = {
  sueldo: 'Sueldo',
  arriendo: 'Arriendo',
  servicios: 'Servicios',
  otro: 'Otro',
}

const PAYMENT_COLORS: Record<string, [number, number, number]> = {
  efectivo: [45, 140, 90],
  tarjeta: [59, 110, 200],
  transferencia: [200, 163, 85],
  credito: [217, 119, 6],
}

const EXPENSE_COLORS: Record<ExpenseCategory, [number, number, number]> = {
  sueldo: [16, 29, 58],
  arriendo: [200, 163, 85],
  servicios: [45, 140, 130],
  otro: [180, 90, 70],
}

const noteStyles = { fontSize: 7, textColor: [130, 130, 130] as [number, number, number], fontStyle: 'italic' as const }

interface DayCash {
  label: string
  amount: number
}

// The till total for one day. Today with an open register: what should be in
// the drawer right now (same formula as useCash.expectedNow). A past day: what
// the register(s) closed that day held. With no register at all it falls back
// to the cash actually collected in sales — labelled as such, so it can never
// be mistaken for the drawer balance.
async function fetchDayCash(branchId: string, day: string, cashSales: number): Promise<DayCash> {
  if (branchId) {
    if (day === todayCL()) {
      const { data: open } = await supabase
        .from('cash_registers')
        .select('id, opening_amount')
        .eq('branch_id', branchId)
        .eq('status', 'open')
        .maybeSingle()
      if (open) {
        const { data: movements } = await supabase.from('cash_movements').select('amount').eq('cash_register_id', open.id as string)
        const moved = (movements ?? []).reduce((s, m) => s + Number(m.amount), 0)
        return { label: 'Efectivo total en caja (caja abierta)', amount: Number(open.opening_amount) + moved }
      }
    }

    const dayStart = new Date(`${day}T00:00:00`)
    const from = new Date(dayStart.getTime() - 86400000).toISOString()
    const to = new Date(dayStart.getTime() + 2 * 86400000).toISOString()
    const { data: closed } = await supabase
      .from('cash_registers')
      .select('closed_at, expected_amount, actual_amount')
      .eq('branch_id', branchId)
      .eq('status', 'closed')
      .gte('closed_at', from)
      .lte('closed_at', to)
      .order('closed_at', { ascending: false })
    const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' })
    const match = (closed ?? []).find((r) => r.closed_at && dayFormatter.format(new Date(r.closed_at as string)) === day)
    if (match) {
      const amount = match.actual_amount ?? match.expected_amount
      if (amount !== null && amount !== undefined) return { label: 'Efectivo en caja al cierre', amount: Number(amount) }
    }
  }
  return { label: 'Efectivo cobrado en el día (sin caja registrada)', amount: cashSales }
}

export async function generateDailyPdf(data: DailyReportData, mode: DailyPdfMode) {
  const detailed = mode === 'detailed'
  const logoDataUrl = await getLogoDataUrl()
  const { doc, contentY } = createPdfDoc(
    detailed ? 'Reporte diario (detallado)' : 'Reporte diario',
    formatDate(`${data.day}T00:00:00`),
    { logoDataUrl, branchName: data.branchName, branchAddress: data.branchAddress }
  )
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  const totalSales = data.sales.reduce((s, sale) => s + sale.total, 0)
  const byMethod: Record<string, number> = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 }
  for (const p of data.payments) byMethod[p.payment_method] = (byMethod[p.payment_method] ?? 0) + p.amount
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0)
  const totalUnits = data.productRows.reduce((s, r) => s + r.quantity, 0)
  const cash = await fetchDayCash(data.branchId, data.day, byMethod.efectivo)

  const summary: [string, string][] = [
    ['Total ventas', formatCLP(totalSales)],
    ['Cantidad de ventas', String(data.sales.length)],
    ['Fardos vendidos (unidades)', String(totalUnits)],
    ['Efectivo', formatCLP(byMethod.efectivo)],
    ['Tarjeta', formatCLP(byMethod.tarjeta)],
    ['Transferencia', formatCLP(byMethod.transferencia)],
  ]
  if (byMethod.credito > 0) summary.push(['Crédito (por cobrar)', formatCLP(byMethod.credito)])
  summary.push(['Gastos', formatCLP(totalExpenses)])
  if (data.transferValue > 0) {
    summary.push(['Traslados a otras sucursales', `${formatCLP(data.transferValue)} (${data.transferCount})`])
  }
  if (detailed) {
    const marginPct = totalSales > 0 ? (data.grossMargin / totalSales) * 100 : 0
    summary.push(
      ['Costo (COGS)', formatCLP(data.cogs)],
      ['Margen bruto', `${formatCLP(data.grossMargin)}  (${marginPct.toFixed(1)}%)`],
      ['Utilidad neta', formatCLP(data.grossMargin - totalExpenses)]
    )
  }

  autoTable(doc, {
    startY: contentY,
    head: [['Resumen del día', '']],
    headStyles: { fillColor: BRAND_NAVY },
    body: summary,
    columnStyles: { 1: { halign: 'right' } },
  })

  // Always printed, whichever variant: the till total is the first thing
  // asked at the end of the day.
  autoTable(doc, {
    startY: finalY() + 6,
    body: [[cash.label, formatCLP(cash.amount)]],
    styles: { fontSize: 11, fontStyle: 'bold', fillColor: [241, 245, 249], textColor: BRAND_NAVY },
    columnStyles: { 1: { halign: 'right' } },
  })

  let belowSummaryY = finalY()
  if (detailed) {
    const chartsTop = finalY() + 12
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('Ventas por método de pago', 14, chartsTop - 3)
    doc.text('Gastos por categoría', 110, chartsTop - 3)
    doc.setTextColor(0)
    const paymentY = addPieChartWithLegend(
      doc,
      14,
      chartsTop,
      [
        { label: 'Efectivo', value: byMethod.efectivo, color: PAYMENT_COLORS.efectivo },
        { label: 'Tarjeta', value: byMethod.tarjeta, color: PAYMENT_COLORS.tarjeta },
        { label: 'Transferencia', value: byMethod.transferencia, color: PAYMENT_COLORS.transferencia },
        { label: 'Crédito', value: byMethod.credito, color: PAYMENT_COLORS.credito },
      ],
      formatCLP
    )
    const expenseY = addPieChartWithLegend(
      doc,
      110,
      chartsTop,
      (Object.keys(expenseLabels) as ExpenseCategory[]).map((c) => ({
        label: expenseLabels[c],
        value: data.expenses.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0),
        color: EXPENSE_COLORS[c],
      })),
      formatCLP
    )
    belowSummaryY = Math.max(paymentY, expenseY) - 10
  }

  // Product table: the simple report leaves out everything about cost.
  const noteRows = await fetchItemNotes(data)
  doc.setFontSize(10)
  doc.setTextColor(30)
  const productsTop = belowSummaryY + 10
  doc.text('Ventas por producto', 14, productsTop - 3)
  doc.setTextColor(0)
  autoTable(doc, {
    startY: productsTop,
    head: [detailed ? ['Producto', 'Calidad', 'Fardos', 'Ingresos', 'Costo', 'Margen', 'Margen %'] : ['Producto', 'Calidad', 'Fardos', 'Ingresos']],
    headStyles: { fillColor: BRAND_NAVY },
    body: data.productRows.flatMap((r) => {
      const label = `${r.calidad}${r.kilo ? ` ${r.kilo}kg` : ''}`
      const main = detailed
        ? [r.productName, label, String(r.quantity), formatCLP(r.revenue), formatCLP(r.cost), formatCLP(r.margin), `${r.marginPct.toFixed(1)}%`]
        : [r.productName, label, String(r.quantity), formatCLP(r.revenue)]
      const notes = noteRows.get(r.variantId) ?? []
      return [
        main,
        ...notes.map((n) => [{ content: `Nota (venta ${n.folio}): ${n.note}`, colSpan: main.length, styles: noteStyles }]),
      ]
    }),
    columnStyles: detailed
      ? { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } }
      : { 2: { halign: 'right' }, 3: { halign: 'right' } },
    styles: { fontSize: 8 },
  })

  if (data.expenses.length > 0) {
    autoTable(doc, {
      startY: finalY() + 10,
      head: [['Gasto', 'Categoría', 'Monto']],
      headStyles: { fillColor: BRAND_NAVY },
      body: data.expenses.map((e) => [e.description, expenseLabels[e.category], formatCLP(e.amount)]),
      columnStyles: { 2: { halign: 'right' } },
      styles: { fontSize: 8 },
    })
  }

  if (detailed && data.commissionRows.length > 0) {
    autoTable(doc, {
      startY: finalY() + 10,
      head: [['Vendedor', 'Ventas', 'Ingresos', '% Comisión', 'Comisión']],
      headStyles: { fillColor: BRAND_NAVY },
      body: data.commissionRows.map((r) => [r.userName, String(r.salesCount), formatCLP(r.revenue), `${r.commissionPct}%`, formatCLP(r.commission)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      styles: { fontSize: 8 },
    })
  }

  const withGeneralNote = data.sales.filter((s) => s.notes?.trim())
  if (withGeneralNote.length > 0) {
    autoTable(doc, {
      startY: finalY() + 10,
      head: [['Folio', 'Cliente', 'Total']],
      headStyles: { fillColor: BRAND_NAVY },
      body: withGeneralNote.flatMap((s) => [
        [s.sale_number ?? '—', s.customer_id ? data.customerNameById.get(s.customer_id) ?? '—' : '—', formatCLP(s.total)],
        [{ content: `Nota: ${s.notes}`, colSpan: 3, styles: noteStyles }],
      ]),
      columnStyles: { 2: { halign: 'right' } },
      styles: { fontSize: 8 },
    })
  }

  doc.save(`reporte-diario${detailed ? '-detallado' : ''}-${data.day}.pdf`)
}

// Per-product-line notes, keyed the same way useProductProfitReport keys its
// rows so each note lands under the product row it belongs to.
async function fetchItemNotes(data: DailyReportData): Promise<Map<string, { folio: string; note: string }[]>> {
  const result = new Map<string, { folio: string; note: string }[]>()
  if (data.sales.length === 0) return result
  const folioById = new Map(data.sales.map((s) => [s.id, s.sale_number ?? '—']))
  const { data: rows } = await supabase
    .from('sale_items')
    .select('sale_id, variant_id, custom_name, notes')
    .in('sale_id', data.sales.map((s) => s.id))
    .not('notes', 'is', null)
    .eq('status', 'active')
  for (const row of rows ?? []) {
    if (!row.notes) continue
    const key = (row.variant_id as string | null) ?? `custom:${row.custom_name as string | null}`
    const list = result.get(key) ?? []
    list.push({ folio: folioById.get(row.sale_id as string) ?? '—', note: row.notes as string })
    result.set(key, list)
  }
  return result
}
