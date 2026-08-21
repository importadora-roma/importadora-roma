import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { I18nProvider, applyDefaultLanguageIfUnset, useTranslation } from '@/i18n/I18nProvider'
import { LanguageToggle } from './LanguageToggle'
import { useContainerSettings } from './useContainerSettings'
import { useEffectiveBranch } from '@/hooks/useEffectiveBranch'

// Wraps every /contenedores/* route with the module-scoped i18n context —
// the rest of the app stays Spanish-hardcoded, this is the one place a
// Turkish-speaking operator can switch.
export function ContainerModuleLayout() {
  return (
    <I18nProvider>
      <ContainerModuleInner />
    </I18nProvider>
  )
}

function ContainerModuleInner() {
  const { branchId } = useEffectiveBranch()
  const { settings } = useContainerSettings(branchId)
  const { setLanguage } = useTranslation()

  useEffect(() => {
    applyDefaultLanguageIfUnset(settings.default_language, setLanguage)
  }, [settings.default_language, setLanguage])

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <LanguageToggle />
      </div>
      <Outlet />
    </div>
  )
}
