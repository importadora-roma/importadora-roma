import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
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
  TrendingUp,
  Menu,
  X,
  KeyRound,
  BookOpen,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import { supabase } from '@/lib/supabase'
import { AlertsBell } from '@/features/alerts/AlertsBell'
import { UpdatesBell } from '@/features/updates/UpdatesBell'
import { GlobalSearch } from '@/features/search/GlobalSearch'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
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
  { to: '/rentabilidad', label: 'Rentabilidad', icon: TrendingUp, roles: ['admin', 'supervisor'] },
  { to: '/auditoria', label: 'Auditoría', icon: ShieldCheck, roles: ['admin'] },
  { to: '/configuracion', label: 'Configuración', icon: Settings, roles: ['admin'] },
]

export function AppLayout() {
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const { branchId: effectiveBranchId, branch } = useEffectiveBranch()
  const isTienda = branch?.branch_type === 'tienda'
  const showFinancialAlerts = (profile?.role === 'admin' || profile?.role === 'supervisor') && !isTienda
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordOk, setPasswordOk] = useState(false)
  const [guideLoading, setGuideLoading] = useState(false)

  // Close the mobile drawer automatically whenever the route changes (e.g.
  // after tapping a nav link), instead of leaving it open over the new page.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  function openPasswordModal() {
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
    setPasswordOk(false)
    setPasswordOpen(true)
  }

  async function handleChangeOwnPassword() {
    setPasswordError(null)
    if (newPassword.length < 6) {
      setPasswordError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden')
      return
    }
    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordSaving(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setPasswordOk(true)
  }

  async function handleDownloadGuide() {
    if (!profile) return
    setGuideLoading(true)
    const { generateUserGuidePdf } = await import('@/features/settings/userGuidePdf')
    await generateUserGuidePdf(profile.role, isTienda, branch?.name ?? 'Importadora Roma')
    setGuideLoading(false)
  }

  const visibleItems = navItems.filter(
    (item) => (!item.roles || (profile && item.roles.includes(profile.role))) && (!item.importadoraOnly || !isTienda)
  )

  return (
    <div className="flex min-h-screen bg-slate-50 md:h-screen md:overflow-hidden">
      {menuOpen && (
        <button
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out md:static md:z-auto md:h-full md:w-60 md:translate-x-0 ${
          menuOpen ? 'translate-x-0 shadow-xl' : ''
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2.5">
            <img src="/pwa-192.png" alt="" className="h-8 w-8 rounded-lg" />
            <div>
              <p className="text-sm font-semibold text-slate-900">Importadora Roma</p>
              <p className="text-xs text-slate-500">{profile?.full_name}</p>
            </div>
          </div>
          <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-600 md:hidden" aria-label="Cerrar menú">
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-700 hover:bg-slate-100'
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
            onClick={handleDownloadGuide}
            disabled={guideLoading}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <BookOpen size={18} />
            {guideLoading ? 'Generando...' : 'Manual de usuario'}
          </button>
          <button
            onClick={openPasswordModal}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <KeyRound size={18} />
            Cambiar contraseña
          </button>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
          <p className="mt-1 select-none px-3 text-[10px] text-slate-300">Hecho por Deniz Semiz</p>
        </div>
      </aside>

      <Modal open={passwordOpen} onClose={() => setPasswordOpen(false)} title="Cambiar mi contraseña">
        <div className="space-y-4">
          {passwordOk ? (
            <p className="text-sm text-green-700">Contraseña actualizada correctamente.</p>
          ) : (
            <>
              <Input label="Nueva contraseña" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Input label="Confirmar contraseña" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPasswordOpen(false)}>
              {passwordOk ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!passwordOk && (
              <Button onClick={handleChangeOwnPassword} disabled={passwordSaving}>
                {passwordSaving ? 'Guardando...' : 'Guardar'}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <main className="flex min-w-0 flex-1 flex-col md:h-full md:overflow-y-auto">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur supports-[backdrop-filter]:bg-white/80 md:justify-end md:px-6 md:pt-3">
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0 flex-1 md:hidden" />
          <div className="hidden md:block md:flex-1">
            <GlobalSearch />
          </div>
          <UpdatesBell />
          <AlertsBell branchId={effectiveBranchId} includeFinancial={showFinancialAlerts} />
          <BranchSwitcher />
        </div>
        <div className="flex-1 p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
