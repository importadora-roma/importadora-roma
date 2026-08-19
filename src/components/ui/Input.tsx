import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface FieldProps {
  label?: string
  error?: string
}

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400'

export function Field({ label, error, children }: FieldProps & { children: ReactNode }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function Input({ label, error, className = '', ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error}>
      <input className={`${fieldClass} ${className}`} {...props} />
    </Field>
  )
}

export function Textarea({
  label,
  error,
  className = '',
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error}>
      <textarea className={`${fieldClass} ${className}`} {...props} />
    </Field>
  )
}

export function Select({
  label,
  error,
  className = '',
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error}>
      <select className={`${fieldClass} bg-white ${className}`} {...props}>
        {children}
      </select>
    </Field>
  )
}
