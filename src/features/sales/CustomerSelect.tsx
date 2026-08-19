import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useCustomers, type Customer } from '@/features/customers/useCustomers'

export function CustomerSelect({
  customerId,
  onChange,
}: {
  customerId: string | null
  onChange: (customerId: string | null) => void
}) {
  const { customers, createCustomer } = useCustomers()
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setSaving(true)
    const result = await createCustomer({ name: name.trim(), phone: phone.trim() || null, rut: null, email: null, address: null, notes: null })
    setSaving(false)
    if (result.error || !result.customer) {
      setError(result.error ?? 'Error al crear cliente')
      return
    }
    onChange(result.customer.id)
    setModalOpen(false)
    setName('')
    setPhone('')
    setError(null)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Select label="Cliente (opcional)" value={customerId ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Sin cliente</option>
          {customers.map((c: Customer) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="secondary" onClick={() => setModalOpen(true)} type="button">
        <UserPlus size={16} />
      </Button>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo cliente rápido">
        <div className="space-y-4">
          <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Creando...' : 'Crear y usar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
