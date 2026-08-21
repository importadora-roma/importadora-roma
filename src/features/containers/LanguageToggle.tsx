import { useTranslation } from '@/i18n/I18nProvider'

export function LanguageToggle() {
  const { language, setLanguage } = useTranslation()

  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
      <button
        onClick={() => setLanguage('es')}
        className={`rounded px-2 py-1 font-medium ${language === 'es' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}
      >
        ES
      </button>
      <button
        onClick={() => setLanguage('tr')}
        className={`rounded px-2 py-1 font-medium ${language === 'tr' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}
      >
        TR
      </button>
    </div>
  )
}
