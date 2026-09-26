import { useCallback, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

/**
 * One action as a sign plate: an ink-bordered panel with a small-caps title.
 * @param {{ title: string, children: React.ReactNode }} props
 */
export function Plate({ title, children }) {
  const id = `plate-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border-2 border-ink bg-white p-3 shadow-plate-sm"
    >
      <h3 id={id} className="section-title mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** @param {{ message: string | null }} props */
export function ActionError({ message }) {
  if (!message) return null
  return (
    <p role="alert" className="field-error">
      <TriangleAlert size={14} strokeWidth={2.5} aria-hidden="true" />
      {message}
    </p>
  )
}

/**
 * Pending and error state for one action. `perform` resolves to
 * `{ ok: true } | { ok: false, message }` (see the page's `act`).
 * @param {(...args: any[]) => Promise<{ ok: boolean, message?: string }>} perform
 */
export function useAction(perform) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const run = useCallback(
    async (...args) => {
      setPending(true)
      setError(null)
      const outcome = await perform(...args)
      setPending(false)
      if (!outcome.ok) setError(outcome.message ?? 'Something went wrong. Try again.')
      return outcome
    },
    [perform],
  )
  return { run, pending, error, setError }
}
