import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null

  // Rendered on document.body rather than in place: a modal triggered from
  // inside the topbar (e.g. BranchSwitcher) would otherwise sit inside its
  // backdrop-blur container, which — like any `filter`/`backdrop-filter` —
  // creates a new containing block for `position: fixed` descendants. That
  // shrinks this overlay down to the topbar's own height instead of the
  // full viewport, which is most visible on a narrow (mobile) screen where
  // the modal ends up rendered mostly off-screen above the fold.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  )
}
