import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ReasonModal } from '@/components/ui/ReasonModal'
import { useCustomers, type Customer } from './useCustomers'

interface CustomerForm {
  name: string
  rut: string
  phone: string
  email: string
  address: string
  notes: string
}

const emptyForm: CustomerForm = { name: '', rut: '', phone: '', email: '', address: '', notes: '' }

export function CustomersPage() {
  const { customers, loading, error, createCustomer, updateCustomer, softDeleteCustomer } = useCustomers()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter(
      (c) => c.name.toLowerCase().includes(term) || (c.rut ?? '').toLowerCase().includes(term) || (c.phone ?? '').includes(term)
    )
  }, [customers, search])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(customer: Customer) {
    setEditing(customer)
    setForm({
      name: customer.name,
      rut: customer.rut ?? '',
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('El nombre es obligatorio')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      rut: form.rut.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }
    const result = editing ? await updateCustomer(editing.id, payload) : await createCustomer(payload)
    setSaving(false)
    if (result.error) {
      setFormError(result.error)
      return
    }
    setModalOpen(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">Gestiona la cartera de clientes.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          Nuevo cliente
        </Button>
      </div>

      <div className="mt-4">
        <Input placeholder="Buscar por nombre, RUT o teléfono..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">RUT</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No hay clientes que coincidan.
                </td>
              </tr>
            )}
            {filtered.map((customer) => (
              <tr key={customer.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{customer.name}</td>
                <td className="px-4 py-3 text-slate-600">{customer.rut || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{customer.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{customer.email || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => openEdit(customer)} className="text-slate-400 hover:text-slate-700">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setDeleteTarget(customer)} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar cliente' : 'Nuevo cliente'}>
        <div className="space-y-4">
          <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="RUT" value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} />
          <Input label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Dirección" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Textarea label="Notas" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Eliminar "${deleteTarget?.name}"`}
        confirmLabel="Eliminar"
        onConfirm={(reason) => softDeleteCustomer(deleteTarget!.id, reason)}
      />
    </div>
  )
}
