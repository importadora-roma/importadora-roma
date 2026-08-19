import { useState } from 'react'
import { Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatCLP, formatDateTime } from '@/lib/format'
import { useCash } from './useCash'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'

const movementLabels: Record<string, string> = {
  sale_payment: 'Pago de venta',
  sale_cancel_refund: 'Reverso por anulación/cambio',
  manual_in: 'Ingreso manual',
  manual_out: 'Retiro manual',
}

export function CashPage() {
  const { branchId: effectiveBranchId, branches } = useEffectiveBranch()

  const { register, movements, loading, error, expectedNow, openRegister, closeRegister, addManualMovement } = useCash(effectiveBranchId)

  const [openModal, setOpenModal] = useState(false)
  const [openingAmount, setOpeningAmount] = useState('')
  const [closeModal, setCloseModal] = useState(false)
  const [actualAmount, setActualAmount] = useState('')
  const [movementModal, setMovementModal] = useState<'manual_in' | 'manual_out' | null>(null)
  const [movementCategory, setMovementCategory] = useState('')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementDescription, setMovementDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleOpen() {
    const amount = Number(openingAmount)
    if (Number.isNaN(amount) || amount < 0) {
      setFormError('Ingresa un monto válido')
      return
    }
    setSaving(true)
    const { error } = await openRegister(amount)
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setOpenModal(false)
    setOpeningAmount('')
    setFormError(null)
  }

  async function handleClose() {
    const amount = Number(actualAmount)
    if (Number.isNaN(amount) || amount < 0) {
      setFormError('Ingresa un monto válido')
      return
    }
    setSaving(true)
    const { error } = await closeRegister(amount)
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setCloseModal(false)
    setActualAmount('')
    setFormError(null)
  }

  async function handleMovement() {
    const amount = Number(movementAmount)
    if (Number.isNaN(amount) || amount <= 0) {
      setFormError('Ingresa un monto válido')
      return
    }
    if (!movementCategory.trim()) {
      setFormError('Indica una categoría (ej: retiro, pago proveedor)')
      return
    }
    setSaving(true)
    const { error } = await addManualMovement(movementModal!, movementCategory.trim(), amount, movementDescription.trim())
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    setMovementModal(null)
    setMovementCategory('')
    setMovementAmount('')
    setMovementDescription('')
    setFormError(null)
  }

  const expectedAtClose = register ? register.opening_amount + movements.reduce((s, m) => s + m.amount, 0) : 0
  const difference = actualAmount ? Number(actualAmount) - expectedAtClose : null

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Caja</h1>

      <p className="mt-1 text-sm text-slate-500">{branches.find((b) => b.id === effectiveBranchId)?.name}</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && effectiveBranchId && !register && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center">
          <Wallet className="mx-auto text-slate-300" size={32} />
          <p className="mt-3 text-slate-600">La caja está cerrada en esta sucursal.</p>
          <Button className="mt-4" onClick={() => setOpenModal(true)}>
            Abrir caja
          </Button>
        </div>
      )}

      {register && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">Apertura</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCLP(register.opening_amount)}</p>
              <p className="text-xs text-slate-400">{formatDateTime(register.opened_at)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">Esperado ahora</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCLP(expectedNow)}</p>
            </div>
            <div className="flex items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
              <Button variant="secondary" onClick={() => setMovementModal('manual_in')}>
                <ArrowDownCircle size={16} />
                Ingreso
              </Button>
              <Button variant="secondary" onClick={() => setMovementModal('manual_out')}>
                <ArrowUpCircle size={16} />
                Retiro
              </Button>
              <Button variant="danger" onClick={() => setCloseModal(true)}>
                Cerrar caja
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      Sin movimientos todavía.
                    </td>
                  </tr>
                )}
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3">{movementLabels[m.movement_type] ?? m.movement_type}</td>
                    <td className="px-4 py-3 text-slate-600">{m.category || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{m.description || '—'}</td>
                    <td className={`px-4 py-3 font-medium ${m.amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {m.amount >= 0 ? '+' : ''}
                      {formatCLP(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Abrir caja">
        <div className="space-y-4">
          <Input label="Monto de apertura" type="number" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpenModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleOpen} disabled={saving}>
              {saving ? 'Abriendo...' : 'Abrir'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar caja">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Monto esperado: {formatCLP(expectedAtClose)}</p>
          <Input label="Monto real contado" type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
          {difference !== null && (
            <p className={`text-sm font-medium ${difference === 0 ? 'text-slate-600' : difference > 0 ? 'text-green-700' : 'text-red-600'}`}>
              Diferencia: {formatCLP(difference)}
            </p>
          )}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCloseModal(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleClose} disabled={saving}>
              {saving ? 'Cerrando...' : 'Cerrar caja'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!movementModal}
        onClose={() => setMovementModal(null)}
        title={movementModal === 'manual_in' ? 'Registrar ingreso' : 'Registrar retiro'}
      >
        <div className="space-y-4">
          <Input label="Categoría" value={movementCategory} onChange={(e) => setMovementCategory(e.target.value)} placeholder="Ej: retiro, pago proveedor" />
          <Input label="Monto" type="number" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} />
          <Input label="Descripción (opcional)" value={movementDescription} onChange={(e) => setMovementDescription(e.target.value)} />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovementModal(null)}>
              Cancelar
            </Button>
            <Button onClick={handleMovement} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
