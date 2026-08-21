import { Link } from 'react-router-dom'
import { HelpCircle, History, PackagePlus, ScanLine } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useTranslation } from '@/i18n/I18nProvider'

export function ContenedoresLandingPage() {
  const profile = useAuthStore((s) => s.profile)
  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor'
  const { t } = useTranslation()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{t('landing.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('landing.subtitle')}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {canManage && (
          <Link
            to="/contenedores/nuevo"
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm"
          >
            <PackagePlus className="mt-0.5 text-slate-500" size={22} />
            <div>
              <p className="font-medium text-slate-900">{t('landing.card.new.title')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('landing.card.new.desc')}</p>
            </div>
          </Link>
        )}
        <Link
          to="/contenedores/activo"
          className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm"
        >
          <ScanLine className="mt-0.5 text-slate-500" size={22} />
          <div>
            <p className="font-medium text-slate-900">{t('landing.card.active.title')}</p>
            <p className="mt-1 text-sm text-slate-500">{t('landing.card.active.desc')}</p>
          </div>
        </Link>
        {canManage && (
          <Link
            to="/contenedores/historial"
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm"
          >
            <History className="mt-0.5 text-slate-500" size={22} />
            <div>
              <p className="font-medium text-slate-900">{t('landing.card.history.title')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('landing.card.history.desc')}</p>
            </div>
          </Link>
        )}
        {canManage && (
          <Link
            to="/contenedores/desconocidos"
            className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm"
          >
            <HelpCircle className="mt-0.5 text-slate-500" size={22} />
            <div>
              <p className="font-medium text-slate-900">{t('landing.card.unknown.title')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('landing.card.unknown.desc')}</p>
            </div>
          </Link>
        )}
      </div>
    </div>
  )
}
