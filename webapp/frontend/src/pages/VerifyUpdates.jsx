/**
 * VerifyUpdates: confirms email updates from the link we emailed
 * (/reports/:id/verify#token=…). ADR 0007: an address is only used once confirmed.
 *
 * The token travels in the URL fragment so it never reaches server logs; we read
 * it once and take it out of the address bar straight away.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, Loader2, MailX, RefreshCw, TriangleAlert } from 'lucide-react'
import { ApiError, verifyUpdates } from '../api/client.js'

const ICON = { size: 18, strokeWidth: 2.25, 'aria-hidden': true }

/**
 * @template T
 * @typedef {{ phase: 'missing' }
 *   | { phase: 'working' }
 *   | { phase: 'done', result: T }
 *   | { phase: 'failed', error: unknown }} TokenCallState
 */

/**
 * Reads `#token=…` from the URL once, removes the fragment from the address bar
 * (history.replaceState, through the router) and calls `call(token)` exactly once
 * per attempt, even when StrictMode runs effects twice.
 *
 * @template T
 * @param {(token: string) => Promise<T>} call
 * @returns {{ state: TokenCallState<T>, retry: () => void }}
 */
export function useFragmentTokenCall(call) {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(
    () => new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || null,
  )
  const [state, setState] = useState(
    /** @type {TokenCallState<T>} */ (token ? { phase: 'working' } : { phase: 'missing' }),
  )
  const [attempt, setAttempt] = useState(0)
  /** @type {import('react').MutableRefObject<{ attempt: number, promise: Promise<T> } | null>} */
  const pending = useRef(null)
  const callRef = useRef(call)
  callRef.current = call

  // Don't leave the token lying around in the address bar or history.
  useEffect(() => {
    if (location.hash) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true })
    }
    // Only on arrival: later renders no longer carry the fragment.
  }, [])

  useEffect(() => {
    if (!token) return undefined
    let active = true
    // A re-run of the same attempt (StrictMode) re-attaches to the request in flight.
    if (pending.current?.attempt !== attempt) {
      pending.current = { attempt, promise: callRef.current(token) }
    }
    pending.current.promise.then(
      (result) => active && setState({ phase: 'done', result }),
      (error) => active && setState({ phase: 'failed', error }),
    )
    return () => {
      active = false
    }
  }, [token, attempt])

  return {
    state,
    retry: () => {
      setState({ phase: 'working' })
      setAttempt((n) => n + 1)
    },
  }
}

/** A 400 means the token itself is bad; anything else is worth retrying. */
export function isInvalidToken(error) {
  return error instanceof ApiError && error.status === 400
}

/** Shared frame for the token pages: a centred plate in the ticket voice. */
export function TokenPageShell({ children }) {
  return <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">{children}</div>
}

/** @param {{ label: string }} props */
export function Working({ label }) {
  return (
    <div role="status" className="flex flex-col items-center py-12 text-center">
      <Loader2 size={32} strokeWidth={2.25} className="animate-spin text-asphalt-500" aria-hidden="true" />
      <p className="mt-4 text-lg font-bold">{label}</p>
    </div>
  )
}

/** @param {{ onRetry: () => void, what: string }} props */
export function RetryableError({ onRetry, what }) {
  return (
    <div
      role="alert"
      className="animate-rise-in rounded-xl border-2 border-hazard-500 bg-hazard-50 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert {...ICON} size={22} className="mt-1 shrink-0 text-hazard-600" />
        <div className="min-w-0">
          <h1 className="text-xl font-black">We couldn&apos;t {what}</h1>
          <p className="mt-1 text-asphalt-600">
            Something went wrong on our side or with your connection. Please try again.
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
            <RefreshCw {...ICON} />
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Calm "this link doesn't work" message, in the 404 · ROAD CLOSED voice.
 * @param {{ code: string, title: string, children: import('react').ReactNode }} props
 */
export function LinkProblem({ code, title, children }) {
  return (
    <div className="animate-rise-in text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-concrete-100">
        <MailX size={26} strokeWidth={2.25} aria-hidden="true" />
      </span>
      <p className="mt-5 font-mono text-sm uppercase text-asphalt-400">{code}</p>
      <h1 className="mt-2 text-3xl font-black leading-tight">{title}</h1>
      {children}
    </div>
  )
}

/** VerifyUpdates: the page behind the confirmation email's link. */
export default function VerifyUpdates() {
  const { id = '' } = useParams()
  const { state, retry } = useFragmentTokenCall((token) => verifyUpdates(id, token))
  const reportPath = `/reports/${encodeURIComponent(id)}`

  let body
  if (state.phase === 'working') {
    body = <Working label="Confirming your email…" />
  } else if (state.phase === 'done') {
    body = (
      <section
        aria-labelledby="verified-heading"
        className="animate-rise-in rounded-xl border-2 border-ink bg-white p-6 text-center shadow-plate sm:p-8"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-go-500 text-white ring-4 ring-go-100">
          <Check size={30} strokeWidth={3} aria-hidden="true" />
        </span>
        <h1 id="verified-heading" className="mt-5 text-3xl font-black leading-tight">
          Email updates are on
        </h1>
        <p className="mt-3 text-[15px] leading-snug text-asphalt-600">
          We&apos;ll email when a repair team is assigned and when the problem is fixed.
        </p>
        <p className="mt-4">
          <span className="readout text-[13px]">
            <span className="sr-only">Sending to </span>
            {state.result.email_masked}
          </span>
        </p>
        <p className="hint mt-4">Every email has a link to stop updates.</p>
        <Link to={reportPath} className="btn-primary mt-6 w-full sm:w-auto">
          See your report
          <ArrowRight {...ICON} />
        </Link>
      </section>
    )
  } else if (state.phase === 'failed' && !isInvalidToken(state.error)) {
    body = <RetryableError onRetry={retry} what="confirm your email" />
  } else {
    const missing = state.phase === 'missing'
    body = (
      <LinkProblem
        code={missing ? 'Link incomplete' : 'Link expired'}
        title={missing ? 'This link is missing a part' : 'This link has expired or was already used'}
      >
        <p className="mx-auto mt-3 max-w-md text-asphalt-600">
          {missing
            ? 'Try opening the link from the email again, or copy the whole link into your browser.'
            : 'Confirmation links only work once and for a limited time. Nothing has changed with your report.'}{' '}
          You can ask for a new link on your report&apos;s page.
        </p>
        <Link to={reportPath} className="btn-primary mt-8">
          Go to your report
          <ArrowRight {...ICON} />
        </Link>
      </LinkProblem>
    )
  }

  return <TokenPageShell>{body}</TokenPageShell>
}
