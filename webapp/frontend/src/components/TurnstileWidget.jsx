/**
 * TurnstileWidget: Cloudflare Turnstile challenge (ADR 0007).
 *
 * Exposes `reset()` through a ref: tokens are single-use, so the form resets the
 * widget after every submit attempt.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RotateCw, ShieldAlert } from 'lucide-react'
import { config } from '../config.js'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** @type {Promise<void> | null} shared by every widget on the page */
let scriptPromise = null

/**
 * Load the Turnstile script once per page. A failed load is forgotten so a
 * retry can try again.
 * @returns {Promise<void>}
 */
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve()
      else fail()
    }
    script.onerror = fail
    function fail() {
      script.remove()
      scriptPromise = null
      reject(new Error('turnstile_load_failed'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * @param {{ onToken: (token: string | null) => void }} props  null when expired/errored
 */
const TurnstileWidget = forwardRef(function TurnstileWidget({ onToken }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let widgetId = null
    loadTurnstile().then(
      () => {
        if (cancelled || !containerRef.current) return
        const clear = () => onTokenRef.current(null)
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: config.turnstileSiteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': clear,
          'error-callback': clear,
          'timeout-callback': clear,
        })
        widgetIdRef.current = widgetId
      },
      () => {
        if (cancelled) return
        setFailed(true)
        onTokenRef.current(null)
      },
    )
    return () => {
      cancelled = true
      if (widgetId != null) {
        window.turnstile?.remove(widgetId)
        if (widgetIdRef.current === widgetId) widgetIdRef.current = null
      }
    }
  }, [attempt])

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        if (widgetIdRef.current != null) window.turnstile?.reset(widgetIdRef.current)
        onTokenRef.current(null)
      },
    }),
    [],
  )

  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-warning-500 bg-warning-50 p-3 text-sm text-gray-800 sm:flex-row sm:items-center"
      >
        <ShieldAlert className="h-5 w-5 shrink-0 text-warning-600" aria-hidden="true" />
        <p className="flex-1">
          Couldn't load the security check. Check your connection and try again.
        </p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setFailed(false)
            setAttempt((a) => a + 1)
          }}
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    )
  }

  return <div ref={containerRef} data-testid="turnstile" className="min-h-[65px]" />
})

export default TurnstileWidget
