import { unitLabel, type UnitType } from '@/lib/format'

export function UnitBadge({ unit, className = '' }: { unit: UnitType | null | undefined; className?: string }) {
  const saco = unit === 'saco'
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none ${
        saco ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
      } ${className}`}
    >
      {unitLabel(unit)}
    </span>
  )
}
