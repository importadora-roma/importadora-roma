const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

export function formatCLP(amount: number): string {
  return clpFormatter.format(amount)
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

export function formatKilo(kilo: number): string {
  return `${kilo % 1 === 0 ? kilo : kilo.toFixed(2)}KG`
}

// Parses Chilean-formatted numbers where "." is a thousands separator and
// "," is the decimal separator (e.g. "12.500" -> 12500, "12.500,50" -> 12500.5).
// A single period followed by 1-2 trailing digits (e.g. "20.5") is treated
// as a plain decimal instead, so kilo values like that still parse right.
export function parseCLNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/[^0-9.,-]/g, '')
  if (!trimmed) return null

  let normalized: string
  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}\.\d{1,2}$/.test(trimmed)) {
    normalized = trimmed
  } else {
    normalized = trimmed.replace(/\./g, '')
  }

  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}
