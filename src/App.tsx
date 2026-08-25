import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SetupScreen } from '@/components/SetupScreen'
import { useAuthStore } from '@/stores/authStore'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute, RoleGate, RequireImportadoraGate } from '@/components/layout/ProtectedRoute'
import { DashboardPage } from '@/features/reports/DashboardPage'

const ConfiguracionPage = lazy(() => import('@/features/settings/ConfiguracionPage').then((m) => ({ default: m.ConfiguracionPage })))
const InventarioTabsPage = lazy(() => import('@/features/inventory/InventarioTabsPage').then((m) => ({ default: m.InventarioTabsPage })))
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })))
const KardexPage = lazy(() => import('@/features/inventory/KardexPage').then((m) => ({ default: m.KardexPage })))
const CashPage = lazy(() => import('@/features/cash/CashPage').then((m) => ({ default: m.CashPage })))
const SalesTabsPage = lazy(() => import('@/features/sales/SalesTabsPage').then((m) => ({ default: m.SalesTabsPage })))
const TransfersTabsPage = lazy(() => import('@/features/transfers/TransfersTabsPage').then((m) => ({ default: m.TransfersTabsPage })))
const QuotationsTabsPage = lazy(() => import('@/features/quotations/QuotationsTabsPage').then((m) => ({ default: m.QuotationsTabsPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const AuditLogsPage = lazy(() => import('@/features/audit/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })))
const CreditsPage = lazy(() => import('@/features/credit/CreditsPage').then((m) => ({ default: m.CreditsPage })))
const InvoicesPage = lazy(() => import('@/features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const ContenedoresLandingPage = lazy(() =>
  import('@/features/containers/ContenedoresLandingPage').then((m) => ({ default: m.ContenedoresLandingPage }))
)
const NewContainerPage = lazy(() => import('@/features/containers/NewContainerPage').then((m) => ({ default: m.NewContainerPage })))
const ActiveCountingPage = lazy(() =>
  import('@/features/containers/ActiveCountingPage').then((m) => ({ default: m.ActiveCountingPage }))
)
const ActiveContainerScreen = lazy(() =>
  import('@/features/containers/ActiveContainerScreen').then((m) => ({ default: m.ActiveContainerScreen }))
)
const UnknownCodesPage = lazy(() => import('@/features/containers/UnknownCodesPage').then((m) => ({ default: m.UnknownCodesPage })))
const ContainerHistoryPage = lazy(() =>
  import('@/features/containers/ContainerHistoryPage').then((m) => ({ default: m.ContainerHistoryPage }))
)
const ContainerDetailPage = lazy(() =>
  import('@/features/containers/ContainerDetailPage').then((m) => ({ default: m.ContainerDetailPage }))
)
const ContainerModuleLayout = lazy(() =>
  import('@/features/containers/ContainerModuleLayout').then((m) => ({ default: m.ContainerModuleLayout }))
)

function PageLoading() {
  return <div className="p-6 text-sm text-slate-400">Cargando...</div>
}

function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    if (isSupabaseConfigured) initialize()
  }, [initialize])

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route
                path="ventas"
                element={
                  <RequireImportadoraGate>
                    <SalesTabsPage />
                  </RequireImportadoraGate>
                }
              />
              <Route
                path="cotizaciones"
                element={
                  <RequireImportadoraGate>
                    <QuotationsTabsPage />
                  </RequireImportadoraGate>
                }
              />
              <Route path="clientes" element={<CustomersPage />} />

              <Route
                path="inventario"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <InventarioTabsPage />
                  </RoleGate>
                }
              />
              <Route
                path="kardex"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <KardexPage />
                  </RoleGate>
                }
              />
              <Route
                path="transferencias"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <TransfersTabsPage />
                  </RoleGate>
                }
              />
              <Route
                path="caja"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <RequireImportadoraGate>
                      <CashPage />
                    </RequireImportadoraGate>
                  </RoleGate>
                }
              />
              <Route
                path="creditos"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <RequireImportadoraGate>
                      <CreditsPage />
                    </RequireImportadoraGate>
                  </RoleGate>
                }
              />
              <Route
                path="facturas"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <RequireImportadoraGate>
                      <InvoicesPage />
                    </RequireImportadoraGate>
                  </RoleGate>
                }
              />
              <Route
                path="contenedores"
                element={
                  <RequireImportadoraGate>
                    <ContainerModuleLayout />
                  </RequireImportadoraGate>
                }
              >
                <Route index element={<ContenedoresLandingPage />} />
                <Route
                  path="nuevo"
                  element={
                    <RoleGate roles={['admin', 'supervisor']}>
                      <NewContainerPage />
                    </RoleGate>
                  }
                />
                <Route path="activo" element={<ActiveCountingPage />} />
                <Route path="activo/:containerId" element={<ActiveContainerScreen />} />
                <Route
                  path="desconocidos"
                  element={
                    <RoleGate roles={['admin', 'supervisor']}>
                      <UnknownCodesPage />
                    </RoleGate>
                  }
                />
                <Route
                  path="historial"
                  element={
                    <RoleGate roles={['admin', 'supervisor']}>
                      <ContainerHistoryPage />
                    </RoleGate>
                  }
                />
                <Route
                  path="historial/:containerId"
                  element={
                    <RoleGate roles={['admin', 'supervisor']}>
                      <ContainerDetailPage />
                    </RoleGate>
                  }
                />
              </Route>
              <Route
                path="reportes"
                element={
                  <RoleGate roles={['admin', 'supervisor']}>
                    <ReportsPage />
                  </RoleGate>
                }
              />
              <Route
                path="auditoria"
                element={
                  <RoleGate roles={['admin']}>
                    <AuditLogsPage />
                  </RoleGate>
                }
              />
              <Route
                path="configuracion"
                element={
                  <RoleGate roles={['admin']}>
                    <ConfiguracionPage />
                  </RoleGate>
                }
              />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
