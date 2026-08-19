import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Textarea } from './Input'

export function ReasonModal({
  open,
  onClose,
  title,
  confirmLabel = 'Confirmar',
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  confirmLabel?: string
  onConfirm: (reason: string) => Promise<{ error: string | null }>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    if (!reason.trim()) {
      setError('Debes indicar un motivo')
      return
    }
    setSubmitting(true)
    const { error } = await onConfirm(reason.trim())
    setSubmitting(false)
    if (error) {
      setError(error)
      return
    }
    setReason('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <Textarea
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Explica brevemente el motivo..."
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Procesando...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
