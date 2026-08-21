import { createContext, useContext, useState, type ReactNode } from 'react'
import es from './es.json'
import tr from './tr.json'
import type { ContainerLanguage } from '@/types/database'

const dictionaries: Record<ContainerLanguage, Record<string, string>> = { es, tr }

const STORAGE_KEY = 'roma_container_lang'

interface I18nContextValue {
  language: ContainerLanguage
  setLanguage: (lang: ContainerLanguage) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLanguage(): ContainerLanguage | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'es' || stored === 'tr' ? stored : null
}

// Scoped to the Contenedores module only — the rest of the app stays
// Spanish-hardcoded. Language choice is per-device (localStorage); an
// admin-set default_language in container_settings only applies to users
// who haven't picked a language on this device yet (see
// useContainerLanguageDefault below).
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<ContainerLanguage>(() => readStoredLanguage() ?? 'es')

  function setLanguage(lang: ContainerLanguage) {
    setLanguageState(lang)
    localStorage.setItem(STORAGE_KEY, lang)
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    const dict = dictionaries[language]
    let text = dict[key] ?? dictionaries.es[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v))
      }
    }
    return text
  }

  return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
}

export function useTranslation() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}

// Applies container_settings.default_language once, only if the user hasn't
// already made an explicit choice on this device.
export function applyDefaultLanguageIfUnset(defaultLanguage: ContainerLanguage, setLanguage: (lang: ContainerLanguage) => void) {
  if (!readStoredLanguage()) setLanguage(defaultLanguage)
}
