import { useState } from 'react'
import { NewTransferPage } from './NewTransferPage'
import { TransferHistoryPage } from './TransferHistoryPage'

const tabs = [
  { key: 'nuevo', label: 'Nuevo traslado' },
  { key: 'historial', label: 'Historial' },
] as const

type TabKey = (typeof tabs)[number]['key']

export function TransfersTabsPage() {
  const [active, setActive] = useState<TabKey>('nuevo')

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Transferencias</h1>

      <div className="mt-4 border-b border-slate-200">
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
        {active === 'nuevo' && <NewTransferPage />}
        {active === 'historial' && <TransferHistoryPage />}
      </div>
    </div>
  )
}
