import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { useContainerSettings } from './useContainerSettings'

// Global settings for the Contenedores module (admin-only). A single row
// (branch_id null) for v1 — see container_settings in
// 0010_container_receiving_schema.sql for the future per-branch override.
export function ContainerSettingsPage() {
  const { settings, loading, updateSettings } = useContainerSettings(null)

  const [ocrThreshold, setOcrThreshold] = useState('')
  const [duplicateWindow, setDuplicateWindow] = useState('')
  const [photoArchive, setPhotoArchive] = useState(false)
  const [defaultLanguage, setDefaultLanguage] = useState<'es' | 'tr'>('es')
  const [blockOverScan, setBlockOverScan] = useState(true)
  const [usdClpRate, setUsdClpRate] = useState('')
  const [operationalMarkupPct, setOperationalMarkupPct] = useState('')
  const [costRounding, setCostRounding] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    setOcrThreshold(String(settings.ocr_confidence_threshold))
    setDuplicateWindow(String(settings.duplicate_scan_window_ms))
    setPhotoArchive(settings.photo_archive_enabled)
    setDefaultLanguage(settings.default_language)
    setBlockOverScan(settings.block_over_scan)
    setUsdClpRate(String(settings.usd_clp_rate))
    setOperationalMarkupPct(String(settings.operational_markup_pct))
    setCostRounding(String(settings.cost_rounding))
  }, [loading, settings])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error } = await updateSettings({
      ocr_confidence_threshold: Number(ocrThreshold),
      duplicate_scan_window_ms: Number(duplicateWindow),
      photo_archive_enabled: photoArchive,
      default_language: defaultLanguage,
      block_over_scan: blockOverScan,
      usd_clp_rate: Number(usdClpRate),
      operational_markup_pct: Number(operationalMarkupPct),
      cost_rounding: Number(costRounding),
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
        Estos ajustes aplican a todos los operadores que usan el módulo de Contenedores.
      </p>

      <Input
        label="Umbral de confianza OCR (%)"
        type="number"
        min={0}
        max={100}
        value={ocrThreshold}
        onChange={(e) => setOcrThreshold(e.target.value)}
      />
      <p className="-mt-3 text-xs text-slate-400">
        Por debajo de este porcentaje, el operador debe confirmar o corregir el código leído por la cámara antes de continuar.
      </p>

      <Input
        label="Ventana anti-doble escaneo (ms)"
        type="number"
        min={1}
        value={duplicateWindow}
        onChange={(e) => setDuplicateWindow(e.target.value)}
      />
      <p className="-mt-3 text-xs text-slate-400">
        Si el mismo código se escanea manualmente dos veces dentro de esta ventana, se pide confirmación antes de contarlo de nuevo.
      </p>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={blockOverScan} onChange={(e) => setBlockOverScan(e.target.checked)} />
        Bloquear por defecto los escaneos que superen la cantidad esperada
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={photoArchive} onChange={(e) => setPhotoArchive(e.target.checked)} />
        Archivar las fotos de las etiquetas escaneadas (usa espacio de almacenamiento)
      </label>

      <Select label="Idioma por defecto para nuevos operadores" value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value as 'es' | 'tr')}>
        <option value="es">Español</option>
        <option value="tr">Türkçe</option>
      </Select>

      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-700">Costeo de fardos</p>
        <p className="mt-1 text-xs text-slate-400">
          Al enviar un contenedor a inventario, el costo de cada producto se calcula como: costo USD/kilo × kilos del producto × valor
          del dólar × (1 + % operacional), redondeado al múltiplo más cercano.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Input label="Valor del dólar (CLP)" type="number" min={0} value={usdClpRate} onChange={(e) => setUsdClpRate(e.target.value)} />
          <Input
            label="% operacional"
            type="number"
            min={0}
            value={operationalMarkupPct}
            onChange={(e) => setOperationalMarkupPct(e.target.value)}
          />
          <Input label="Redondear a" type="number" min={1} value={costRounding} onChange={(e) => setCostRounding(e.target.value)} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Configuración guardada.</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Guardando...' : 'Guardar cambios'}
      </Button>
    </div>
  )
}
