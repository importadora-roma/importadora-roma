import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Megaphone, X } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { useAppUpdates } from './useAppUpdates'

export function UpdatesBell() {
  const [open, setOpen] = useState(false)
  const { updates, unseenCount, dismiss } = useAppUpdates()

  function close() {
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
        aria-label="Novedades"
      >
        <Megaphone size={19} />
        {unseenCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unseenCount > 99 ? '99+' : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Portaled — see AlertsBell.tsx for why: this bell sits inside
              the topbar's backdrop-blur, which becomes the containing
              block for `fixed` descendants and shrinks this full-screen
              click-outside catcher down to the topbar's own height. */}
          {createPortal(
            <button aria-label="Cerrar novedades" onClick={close} className="fixed inset-0 z-40 cursor-default" />,
            document.body
          )}
          <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Novedades</p>
            </div>

            {updates.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Sin novedades nuevas.</p>}

            <div className="divide-y divide-slate-100">
              {updates.map((u) => (
                <div key={u.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{u.title}</p>
                    <button
                      onClick={() => dismiss(u.id)}
                      className="shrink-0 text-slate-300 hover:text-slate-600"
                      aria-label="Descartar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{u.description}</p>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {formatDateTime(u.released_at)} · Deniz Semiz
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
