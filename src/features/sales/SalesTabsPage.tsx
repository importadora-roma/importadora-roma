import { useState } from 'react'
import { NewSalePage } from './NewSalePage'
import { SalesHistoryPage } from './SalesHistoryPage'

const tabs = [
  { key: 'nueva', label: 'Nueva venta' },
  { key: 'historial', label: 'Historial' },
] as const

type TabKey = (typeof tabs)[number]['key']

export function SalesTabsPage() {
  const [active, setActive] = useState<TabKey>('nueva')

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
        {active === 'nueva' && <NewSalePage />}
        {active === 'historial' && <SalesHistoryPage />}
      </div>
    </div>
  )
}
