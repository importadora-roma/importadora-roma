import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Users,
  Package,
  ClipboardList,
  Truck,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  ShieldCheck,
  CreditCard,
  Boxes,
  Receipt,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { BranchSwitcher } from './BranchSwitcher'
import type { UserRole } from '@/types/models'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: UserRole[]
  importadoraOnly?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Panel', icon: LayoutDashboard },
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart, importadoraOnly: true },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: FileText, importadoraOnly: true },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/inventario', label: 'Inventario', icon: Package, roles: ['admin', 'supervisor'] },
  { to: '/kardex', label: 'Kardex', icon: ClipboardList, roles: ['admin', 'supervisor'] },
  { to: '/transferencias', label: 'Transferencias', icon: Truck, roles: ['admin', 'supervisor'] },
  { to: '/contenedores', label: 'Contenedores', icon: Boxes, importadoraOnly: true },
  { to: '/caja', label: 'Caja', icon: Wallet, roles: ['admin', 'supervisor'], importadoraOnly: true },
  { to: '/creditos', label: 'Créditos', icon: CreditCard, roles: ['admin', 'supervisor'], importadoraOnly: true },
  { to: '/facturas', label: 'Facturas', icon: Receipt, roles: ['admin', 'supervisor'], importadoraOnly: true },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['admin', 'supervisor'] },
  { to: '/auditoria', label: 'Auditoría', icon: ShieldCheck, roles: ['admin'] },
  { to: '/configuracion', label: 'Configuración', icon: Settings, roles: ['admin'] },
]

export function AppLayout() {
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const { branch } = useEffectiveBranch()
  const isTienda = branch?.branch_type === 'tienda'

  const visibleItems = navItems.filter(
    (item) => (!item.roles || (profile && item.roles.includes(profile.role))) && (!item.importadoraOnly || !isTienda)
  )

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">Importadora Roma</p>
          <p className="text-xs text-slate-500">{profile?.full_name}</p>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="flex justify-end border-b border-slate-200 bg-white px-6 py-3">
          <BranchSwitcher />
        </div>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
