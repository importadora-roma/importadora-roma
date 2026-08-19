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
