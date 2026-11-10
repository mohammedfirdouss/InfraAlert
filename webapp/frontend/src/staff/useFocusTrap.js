import { useCallback, useEffect, useRef } from 'react'

/** Everything Tab can land on inside a dialog. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus handling for a modal dialog or drawer: moves focus in when it opens,
 * hands it back when it closes, and keeps Tab inside `containerRef`.
 *
 * Returns a keydown handler: put it on the dialog's wrapper (or call it from a
 * document listener). It wraps Tab and passes Escape to `onEscape`, which
 * decides what closing means (and whether to stop the event).
 *
 * @param {import('react').RefObject<HTMLElement | null>} containerRef
 * @param {{
 *   active?: boolean,                 false while the dialog is closed (default true: open while mounted)
 *   initialFocus?: import('react').RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined),
 *   restoreFocus?: import('react').RefObject<HTMLElement | null>,   default: whatever had focus on open
 *   onEscape?: (event: KeyboardEvent) => void,
 *   wrapFromOutside?: boolean,        also pull focus back in when Tab is pressed with focus outside
 * }} [options]
 * @returns {(event: KeyboardEvent | import('react').KeyboardEvent) => void}
 */
export function useFocusTrap(containerRef, options = {}) {
  const { active = true } = options
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!active) return undefined
    const { initialFocus, restoreFocus } = latest.current
    const opener = document.activeElement
    const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus?.current
    target?.focus()
    return () => {
      const back = restoreFocus ? restoreFocus.current : opener
      if (back instanceof HTMLElement) back.focus()
    }
  }, [active])

  return useCallback(
    (event) => {
      if (event.key === 'Escape') {
        latest.current.onEscape?.(event)
        return
      }
      const container = containerRef.current
      if (event.key !== 'Tab' || !container) return
      const items = [...container.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const outside = Boolean(latest.current.wrapFromOutside) && !container.contains(current)
      if (event.shiftKey && (current === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    },
    [containerRef],
  )
}
