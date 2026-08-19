export function SetupScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Falta configurar Supabase</h1>
        <p className="mt-3 text-sm text-slate-600">
          Crea un archivo <code className="rounded bg-slate-100 px-1.5 py-0.5">.env</code> en la
          raíz del proyecto (puedes copiar <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.example</code>)
          y completa:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
{`VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key`}
        </pre>
        <p className="mt-3 text-sm text-slate-600">
          Luego reinicia el servidor de desarrollo (<code className="rounded bg-slate-100 px-1.5 py-0.5">npm run dev</code>).
        </p>
      </div>
    </div>
  )
}
