/**
 * UpdatesSignup: optional email updates, on the report status page (ADR 0007).
 *
 * Citizens stay anonymous unless they ask for updates, and an address is only
 * used after they confirm it from the link we email them. The CAPTCHA token is
 * single-use, so the widget is reset after every request.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, BellRing, Check, Loader2, Mail, Send } from 'lucide-react'
import { ApiError, subscribeToUpdates } from '../api/client.js'
import TurnstileWidget from './TurnstileWidget.jsx'

/** Statuses after which nothing changes, so there's nothing to be told about. */
const FINAL_STATUSES = new Set(['resolved', 'closed'])

export const MESSAGES = {
  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter a complete email address, like name@example.com.',
  captchaPending:
    "The security check hasn't finished yet. Wait a moment for it to complete, then try again.",
  captchaFailed: "The security check didn't go through. Please complete it again and resend.",
  rateLimited:
    'Too many requests have come from this network. Please wait a while and try again.',
  network: "Couldn't reach InfraAlert. Check your connection and try again.",
  unknown: 'Something went wrong on our side. Please try again.',
}

const ICON = { size: 18, strokeWidth: 2.25, 'aria-hidden': true }

/** A light check that catches typos before we spend a CAPTCHA on them. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * @param {{
 *   reportId: string,
 *   maskedEmail?: string | null,
 *   status: import('../api/client.js').ReportStatus,
 * }} props
 */
export default function UpdatesSignup({ reportId, maskedEmail, status }) {
  if (FINAL_STATUSES.has(status)) return null

  return (
    <section
      aria-labelledby="updates-heading"
      className="card animate-rise-in p-5 sm:p-6"
      data-testid="updates-signup"
    >
      {maskedEmail ? <UpdatesOn maskedEmail={maskedEmail} /> : <SignupForm reportId={reportId} />}
    </section>
  )
}

/** @param {{ maskedEmail: string }} props */
function UpdatesOn({ maskedEmail }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-go-500 text-white ring-4 ring-go-100">
        <Check size={18} strokeWidth={3} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 id="updates-heading" className="text-lg font-black leading-tight">
          Email updates are on for{' '}
          <span className="break-all font-mono text-base font-semibold">{maskedEmail}</span>
        </h2>
        <p className="mt-1 text-[15px] leading-snug text-asphalt-600">
          We&apos;ll email when a repair team is assigned and when the problem is fixed. To stop,
          use the link at the bottom of any update email.
        </p>
      </div>
    </div>
  )
}

/** @param {{ reportId: string }} props */
function SignupForm({ reportId }) {
  const [email, setEmail] = useState('')
  const [captchaToken, setCaptchaToken] = useState(/** @type {string | null} */ (null))
  const [submitting, setSubmitting] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [formError, setFormError] = useState('')
  const [sentTo, setSentTo] = useState(/** @type {string | null} */ (null))
  const turnstileRef = useRef(/** @type {{ reset: () => void } | null} */ (null))
  const emailRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const sentHeadingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null))
  // Where focus goes after switching views, so keyboard and screen-reader users follow along.
  const focusAfterSwitch = useRef(/** @type {'email' | 'sent' | null} */ (null))

  useEffect(() => {
    const target = focusAfterSwitch.current
    focusAfterSwitch.current = null
    if (target === 'sent') sentHeadingRef.current?.focus()
    else if (target === 'email') emailRef.current?.focus()
  }, [sentTo])

  /** @param {string | null} token */
  function handleCaptchaToken(token) {
    setCaptchaToken(token)
    if (token && formError === MESSAGES.captchaPending) setFormError('')
  }

  /** @param {import('react').FormEvent} event */
  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const address = email.trim()
    setFormError('')

    if (!address || !EMAIL_SHAPE.test(address)) {
      setEmailError(address ? MESSAGES.emailInvalid : MESSAGES.emailMissing)
      emailRef.current?.focus()
      return
    }
    setEmailError('')
    if (!captchaToken) {
      setFormError(MESSAGES.captchaPending)
      return
    }

    setSubmitting(true)
    try {
      await subscribeToUpdates(reportId, { email: address, captcha_token: captchaToken })
      focusAfterSwitch.current = 'sent'
      setSentTo(address)
    } catch (err) {
      handleError(err)
    } finally {
      // Tokens are single-use: every attempt needs a fresh one.
      turnstileRef.current?.reset()
      setCaptchaToken(null)
      setSubmitting(false)
    }
  }

  /** @param {unknown} err */
  function handleError(err) {
    if (err instanceof ApiError) {
      if (err.status === 400 && err.detail === 'captcha_failed') {
        setFormError(MESSAGES.captchaFailed)
      } else if (err.status === 429) {
        setFormError(MESSAGES.rateLimited)
      } else if (err.status === 422) {
        setEmailError(MESSAGES.emailInvalid)
        emailRef.current?.focus()
      } else {
        setFormError(MESSAGES.unknown)
      }
    } else if (err instanceof TypeError) {
      setFormError(MESSAGES.network)
    } else {
      setFormError(MESSAGES.unknown)
    }
  }

  function changeAddress() {
    setSentTo(null)
    setEmail('')
    setEmailError('')
    setFormError('')
    focusAfterSwitch.current = 'email'
  }

  if (sentTo) {
    return (
      <div>
        <h2
          id="updates-heading"
          ref={sentHeadingRef}
          tabIndex={-1}
          className="flex items-center gap-2.5 text-lg font-black leading-tight"
        >
          <Mail {...ICON} size={20} className="shrink-0" />
          Confirm your email
        </h2>
        <div role="status" className="mt-3 animate-rise-in">
          <p className="text-[15px] font-semibold leading-snug text-ink">
            Check your inbox: we sent a link to confirm.
          </p>
          <p className="mt-2">
            <span className="readout max-w-full break-all text-[13px]">{sentTo}</span>
          </p>
        </div>
        <p className="hint mt-3">
          Updates start once you open the link. If it hasn&apos;t arrived in a few minutes, check
          your spam folder.
        </p>
        <button type="button" className="btn-ghost -ml-3 mt-2" onClick={changeAddress}>
          Use a different address
        </button>
      </div>
    )
  }

  const describedBy = ['updates-email-hint', emailError && 'updates-email-error']
    .filter(Boolean)
    .join(' ')

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="updates-heading" className="flex items-center gap-2.5 text-lg font-black leading-tight">
          <BellRing {...ICON} size={20} className="shrink-0" />
          Get an email when this changes
        </h2>
        <span className="tag shrink-0">Optional</span>
      </div>
      <p className="mt-2 text-[15px] leading-snug text-asphalt-600">
        We&apos;ll email you when a repair team is assigned and when the problem is fixed. Nothing
        else, and you can stop any time.
      </p>

      <div className="mt-5">
        <label htmlFor="updates-email" className="label">
          Your email address
        </label>
        <input
          ref={emailRef}
          id="updates-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className="input"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (emailError) setEmailError('')
          }}
          aria-invalid={emailError ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        <p id="updates-email-hint" className="hint">
          We&apos;ll send a link to confirm it&apos;s yours. Nothing is sent until you do.
        </p>
        {emailError && (
          <p id="updates-email-error" className="field-error animate-rise-in">
            <AlertCircle size={15} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
            {emailError}
          </p>
        )}
      </div>

      <div className="mt-4" role="group" aria-label="Security check">
        <TurnstileWidget ref={turnstileRef} onToken={handleCaptchaToken} />
      </div>

      <button type="submit" className="btn-primary mt-4 w-full sm:w-auto" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 {...ICON} className="animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send {...ICON} />
            Send confirmation email
          </>
        )}
      </button>

      {/* role="alert" is announced as soon as it appears. */}
      {formError && (
        <div
          role="alert"
          className="mt-4 flex animate-rise-in items-start gap-3 rounded-md border border-l-4 border-hazard-100 border-l-hazard-500 bg-hazard-50 px-4 py-3 text-sm font-semibold leading-snug text-ink"
        >
          <AlertTriangle {...ICON} className="mt-px shrink-0 text-hazard-600" />
          <span>{formError}</span>
        </div>
      )}
    </form>
  )
}
