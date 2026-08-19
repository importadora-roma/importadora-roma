import { useState } from 'react'
import { ProductsPage } from '@/features/products/ProductsPage'
import { InventoryPage } from './InventoryPage'
import { ImportPage } from './ImportPage'

const tabs = [
  { key: 'stock', label: 'Stock' },
  { key: 'productos', label: 'Productos' },
  { key: 'importar', label: 'Importar' },
] as const

type TabKey = (typeof tabs)[number]['key']

export function InventarioTabsPage() {
  const [active, setActive] = useState<TabKey>('stock')

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
        {active === 'stock' && <InventoryPage />}
        {active === 'productos' && <ProductsPage />}
        {active === 'importar' && <ImportPage />}
      </div>
    </div>
  )
}
