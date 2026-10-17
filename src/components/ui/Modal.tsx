import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const maxWidthBySize = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: keyof typeof maxWidthBySize
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-950/50 p-4 backdrop-blur-sm">
      <div className={`flex max-h-[95vh] w-full ${maxWidthBySize[size]} flex-col rounded-xl bg-white shadow-2xl ring-1 ring-black/5`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {/* min-h-0 overrides the flex item's default min-height:auto, which
            otherwise refuses to let this child shrink below its content's
            natural size — without it, overflowing content (e.g. an
            absolutely-positioned dropdown from ProductSearch) can get
            clipped right at the edge instead of this div actually scrolling
            to reveal it. */}
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  )
}
