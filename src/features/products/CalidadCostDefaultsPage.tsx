import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatCLP } from '@/lib/format'
import { useCalidadCostDefaults } from './useCalidadCostDefaults'

export function CalidadCostDefaultsPage() {
  const { defaults, loading, upsertDefault, deleteDefault } = useCalidadCostDefaults()

  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newCalidad, setNewCalidad] = useState('')
  const [newCost, setNewCost] = useState('')

  async function handleSaveRow(calidad: string) {
    const raw = editValues[calidad]
    const value = Number(raw)
    if (raw === undefined || Number.isNaN(value) || value < 0) {
      setError('El costo debe ser un número válido')
      return
    }
    setError(null)
    setSavingKey(calidad)
    const { error } = await upsertDefault(calidad, value)
    setSavingKey(null)
    if (error) {
      setError(error)
      return
    }
    setEditValues((prev) => {
      const next = { ...prev }
      delete next[calidad]
      return next
    })
  }

  async function handleAdd() {
    if (!newCalidad.trim()) {
      setError('Indica la calidad')
      return
    }
    const value = Number(newCost)
    if (Number.isNaN(value) || value < 0) {
      setError('El costo debe ser un número válido')
      return
    }
    setError(null)
    setSavingKey('__new__')
    const { error } = await upsertDefault(newCalidad.trim(), value)
    setSavingKey(null)
    if (error) {
      setError(error)
      return
    }
    setNewCalidad('')
    setNewCost('')
  }

  async function handleDelete(calidad: string) {
    setSavingKey(calidad)
    await deleteDefault(calidad)
    setSavingKey(null)
  }

  if (loading) return <p className="text-sm text-slate-400">Cargando...</p>

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-slate-500">
        Al crear una variante de producto nueva, el costo se rellena automáticamente según la calidad elegida (siempre puedes
        cambiarlo antes de guardar). No afecta variantes que ya existen.
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Calidad</th>
              <th className="px-4 py-3">Costo por defecto</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {defaults.map((d) => (
              <tr key={d.calidad}>
                <td className="px-4 py-3 font-medium text-slate-900">{d.calidad}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    value={editValues[d.calidad] ?? String(d.default_cost)}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [d.calidad]: e.target.value }))}
                    onBlur={() => editValues[d.calidad] !== undefined && handleSaveRow(d.calidad)}
                    className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="ml-2 text-xs text-slate-400">{formatCLP(d.default_cost)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(d.calidad)}
                    disabled={savingKey === d.calidad}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-3">
                <Input value={newCalidad} onChange={(e) => setNewCalidad(e.target.value)} placeholder="Ej: Cuarta" />
              </td>
              <td className="px-4 py-3">
                <Input type="number" min={0} value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="0" />
              </td>
              <td className="px-4 py-3 text-right">
                <Button variant="secondary" onClick={handleAdd} disabled={savingKey === '__new__'}>
                  <Plus size={14} />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
