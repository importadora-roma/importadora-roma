import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'
import type { UserRole } from '@/types/models'

export function RoleGate({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const profile = useAuthStore((s) => s.profile)
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

// Blocks sales/cash/quotations for "tienda" branches — they run their own
// point-of-sale, this ERP only tracks the stock they receive via traslado.
export function RequireImportadoraGate({ children }: { children: ReactNode }) {
  const { branch, loading } = useEffectiveBranch()
  if (loading) return null
  if (branch?.branch_type === 'tienda') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const session = useAuthStore((s) => s.session)
  const profile = useAuthStore((s) => s.profile)
  const loading = useAuthStore((s) => s.loading)

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Cargando...</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (roles && (!profile || !roles.includes(profile.role))) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
