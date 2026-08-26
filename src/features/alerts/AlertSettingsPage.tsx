import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAlertSettings } from './useAlertSettings'

export function AlertSettingsPage() {
  const { settings, loading, updateSettings } = useAlertSettings()

  const [lowStockThreshold, setLowStockThreshold] = useState('')
  const [creditTermDays, setCreditTermDays] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    setLowStockThreshold(String(settings.low_stock_threshold))
    setCreditTermDays(String(settings.credit_default_term_days))
  }, [loading, settings])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error } = await updateSettings({
      low_stock_threshold: Number(lowStockThreshold),
      credit_default_term_days: Number(creditTermDays),
    })
    setSaving(false)
    if (error) {
      setError(error)
      return
    }
    setSaved(true)
  }

  if (loading) return <p className="text-sm text-slate-400">Cargando...</p>

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-slate-500">
        Estos ajustes controlan cuándo aparece algo en la campana de alertas, para todas las sucursales.
      </p>

      <Input
        label="Umbral de stock bajo (unidades)"
        type="number"
        min={0}
        value={lowStockThreshold}
        onChange={(e) => setLowStockThreshold(e.target.value)}
      />
      <p className="-mt-3 text-xs text-slate-400">
        Un producto aparece en "Stock bajo" cuando su cantidad en una sucursal es igual o menor a este número.
      </p>

      <Input
        label="Plazo de crédito por defecto (días)"
        type="number"
        min={1}
        value={creditTermDays}
        onChange={(e) => setCreditTermDays(e.target.value)}
      />
      <p className="-mt-3 text-xs text-slate-400">
        Al registrar una venta a crédito, la fecha de vencimiento se sugiere automáticamente sumando estos días a la fecha de venta
        (editable en cada venta).
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Configuración guardada.</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </Button>
    </div>
  )
}
