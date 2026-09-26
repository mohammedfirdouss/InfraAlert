/**
 * Loading, empty, error and toast pieces shared by the Teams and Staff pages.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RotateCw, X } from 'lucide-react'

const TOAST_MS = 5000

/**
 * Short-lived success messages. Render `<Toasts>` once per page.
 * @returns {{ toasts: { id: number, message: string }[], notify: (message: string) => void, dismiss: (id: number) => void }}
 */
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (message) => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, message }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  return { toasts, notify, dismiss }
}

/** The live region is always mounted so screen readers announce new toasts. */
export function Toasts({ toasts, dismiss }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[1200] flex flex-col items-end gap-2 sm:left-auto sm:right-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-sm animate-rise-in items-center gap-2 rounded-md border-2 border-ink bg-white py-1 pl-3 pr-1 text-sm font-semibold text-ink shadow-plate-sm"
        >
          <CheckCircle2 size={18} strokeWidth={2.5} className="shrink-0 text-go-600" aria-hidden="true" />
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-asphalt-500 hover:text-ink"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
          >
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Placeholder rows while a list loads. */
export function SkeletonRows({ rows = 5, label = 'Loading' }) {
  return (
    <div aria-busy="true" className="divide-y divide-concrete-200">
      <span className="sr-only" role="status">
        {label}…
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3.5" aria-hidden="true">
          <div className="h-3.5 w-1/4 rounded bg-concrete-200" />
          <div className="h-3.5 w-1/3 rounded bg-concrete-200" />
          <div className="ml-auto h-3.5 w-16 rounded bg-concrete-200" />
        </div>
      ))}
    </div>
  )
}

/** A failed load, with a way to try again. */
export function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6">
      <p className="field-error mt-0">
        <AlertCircle size={16} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
        {message}
      </p>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        <RotateCw size={16} strokeWidth={2.5} aria-hidden="true" />
        Try again
      </button>
    </div>
  )
}

/** Nothing to show yet: say so and what to do next. */
export function EmptyState({ title, children }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-bold text-ink">{title}</p>
      {children && <p className="mt-1 text-sm text-asphalt-500">{children}</p>}
    </div>
  )
}

/** An inline error message (inside forms and rows). */
export function InlineError({ children, id }) {
  if (!children) return null
  return (
    <p id={id} className="field-error animate-rise-in">
      <AlertCircle size={15} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

/**
 * Plain words for a failed request. `messages` maps backend detail codes.
 * @param {unknown} error @param {Record<string, string>} [messages]
 */
export function describeError(error, messages = {}) {
  const detail = /** @type {any} */ (error)?.detail
  if (typeof detail === 'string' && messages[detail]) return messages[detail]
  const status = /** @type {any} */ (error)?.status
  if (status === 403) return "You don't have permission to do that."
  if (status === 422) return 'Some of the details were not accepted. Check them and try again.'
  if (status) return 'Something went wrong on our side. Try again in a moment.'
  return "We couldn't reach the server. Check your connection and try again."
}
