export function PlaceholderPage({ title, stage }: { title: string; stage: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        Este módulo se construye en la etapa "{stage}" del plan de desarrollo. Aún no implementado.
      </p>
    </div>
  )
}
