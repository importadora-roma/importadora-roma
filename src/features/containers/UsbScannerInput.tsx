import { useEffect, useRef } from 'react'

const FAST_KEYSTROKE_MS = 50

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

// USB barcode readers act as a keyboard, typing the code followed by Enter.
// The manual code field already handles that fine while it's focused — this
// listener is the resilience fallback for when focus has drifted elsewhere
// (the operator clicked a filter, scrolled the table, etc.), so a scan
// isn't silently lost. It ignores keystrokes while an actual form field has
// focus, since that field owns its own Enter handling already.
export function UsbScannerInput({ active, onScan }: { active: boolean; onScan: (code: string) => void }) {
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)

  useEffect(() => {
    if (!active) return

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return

      const now = Date.now()
      const elapsed = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        const code = bufferRef.current
        bufferRef.current = ''
        if (code.length > 0) onScan(code)
        return
      }

      if (e.key.length !== 1) return

      if (elapsed > FAST_KEYSTROKE_MS && bufferRef.current.length > 0) {
        bufferRef.current = ''
      }
      bufferRef.current += e.key
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [active, onScan])

  return null
}
