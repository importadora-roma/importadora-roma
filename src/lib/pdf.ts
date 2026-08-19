import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const COMPANY_NAME = 'Importadora Roma'

export function createPdfDoc(title: string, subtitle?: string) {
  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text(COMPANY_NAME, 14, 18)
  doc.setFontSize(11)
  doc.text(title, 14, 26)
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(subtitle, 14, 32)
    doc.setTextColor(0)
  }
  return doc
}

export { autoTable }
