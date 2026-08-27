import { useState } from 'react'
import { BranchesPage } from '@/features/branches/BranchesPage'
import { UsersPage } from '@/features/users/UsersPage'
import { ContainerSettingsPage } from '@/features/containers/ContainerSettingsPage'
import { AlertSettingsPage } from '@/features/alerts/AlertSettingsPage'
import { CalidadCostDefaultsPage } from '@/features/products/CalidadCostDefaultsPage'

const tabs = [
  { key: 'sucursales', label: 'Sucursales' },
  { key: 'usuarios', label: 'Usuarios' },
  { key: 'contenedores', label: 'Contenedores' },
  { key: 'alertas', label: 'Alertas' },
  { key: 'costos', label: 'Costos por calidad' },
] as const

type TabKey = (typeof tabs)[number]['key']

export function ConfiguracionPage() {
  const [active, setActive] = useState<TabKey>('sucursales')

  return (
    <div>
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                active === tab.key
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {active === 'sucursales' && <BranchesPage />}
        {active === 'usuarios' && <UsersPage />}
        {active === 'contenedores' && <ContainerSettingsPage />}
        {active === 'alertas' && <AlertSettingsPage />}
        {active === 'costos' && <CalidadCostDefaultsPage />}
      </div>
    </div>
  )
}
