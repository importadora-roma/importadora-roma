// Chilean mobile numbers are usually saved without the country code
// (e.g. "9 1234 5678"); wa.me needs the full international digits.
function normalizeChileanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('56')) return digits
  if (digits.length === 9 && digits.startsWith('9')) return `56${digits}`
  return digits
}

export function whatsappUrl(phone: string | null, message: string): string {
  const digits = phone ? normalizeChileanPhone(phone) : ''
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(message)}`
}

export function mailtoUrl(email: string | null, subject: string, body: string): string {
  return `mailto:${email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
