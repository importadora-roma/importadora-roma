import * as XLSX from 'xlsx'

export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, blankrows: false })
  return rows.map((row) => row.map((cell) => (cell ?? '').toString().trim()))
}

export function parseDelimitedText(text: string): string[][] {
  const delimiter = text.includes('\t') ? '\t' : ','
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()))
}

export function exportToExcel(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, filename)
}

export interface StyledExcelColumn {
  header: string
  key: string
  width?: number
  // Excel number format string (e.g. '#,##0' for thousands separators) —
  // only applied when the cell value is a number, so text columns are safe.
  numFmt?: string
}

// Excel export with a branded info block (title/branch/date), sized columns,
// and an optional totals row — the plain json_to_sheet exports elsewhere
// just dump raw rows, but reports handed to customers/accounting need more
// structure than that.
export function exportStyledExcel({
  filename,
  sheetName,
  title,
  subtitle = [],
  columns,
  rows,
  totals,
}: {
  filename: string
  sheetName: string
  title: string
  subtitle?: string[]
  columns: StyledExcelColumn[]
  rows: Record<string, unknown>[]
  totals?: Record<string, unknown>
}) {
  const aoa: unknown[][] = []
  aoa.push([title])
  for (const line of subtitle) aoa.push([line])
  aoa.push([])

  const headerRowIndex = aoa.length
  aoa.push(columns.map((c) => c.header))
  for (const row of rows) aoa.push(columns.map((c) => row[c.key] ?? ''))

  const totalsRowIndex = totals ? aoa.length : null
  if (totals) aoa.push(columns.map((c) => totals[c.key] ?? ''))

  const worksheet = XLSX.utils.aoa_to_sheet(aoa)
  worksheet['!cols'] = columns.map((c) => ({ wch: c.width ?? 16 }))

  const lastCol = columns.length - 1
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    ...subtitle.map((_, i) => ({ s: { r: i + 1, c: 0 }, e: { r: i + 1, c: lastCol } })),
  ]

  for (const rowIndex of [...rows.map((_, i) => headerRowIndex + 1 + i), totalsRowIndex].filter(
    (i): i is number => i !== null
  )) {
    columns.forEach((c, colIndex) => {
      if (!c.numFmt) return
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
      const cell = worksheet[ref]
      if (cell && cell.t === 'n') cell.z = c.numFmt
    })
  }

  const workbook = XLSX.utils.book_new()
  const safeName = sheetName.replace(/[[\]:*?/\\]/g, '').slice(0, 31)
  XLSX.utils.book_append_sheet(workbook, worksheet, safeName)
  XLSX.writeFile(workbook, filename)
}

export function exportMultiSheetExcel(filename: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
    // Sheet names are capped at 31 chars and can't contain []:*?/\\
    const safeName = sheet.name.replace(/[[\]:*?/\\]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName)
  }
  XLSX.writeFile(workbook, filename)
}
