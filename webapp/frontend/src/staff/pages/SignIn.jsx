/**
 * Staff sign-in page (ADR 0007): the city SSO button, or in development a
 * seeded-account picker. Also shown to people who signed in but aren't staff.
 */
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, CircleAlert, LogOut } from 'lucide-react'
import { LogoMark } from '../../components/Logo.jsx'
import { config } from '../../config.js'
import { useStaff } from '../auth.jsx'

export const DEV_ACCOUNTS = [
  { email: 'dispatcher@dev.local', role: 'Dispatcher' },
  { email: 'supervisor@dev.local', role: 'Supervisor' },
  { email: 'admin@dev.local', role: 'Admin' },
]

/** Where to go after sign-in: the page they wanted (guard's location state), or the queue. */
function destination(state) {
  const from = state?.from
  if (from && typeof from.pathname === 'string' && from.pathname.startsWith('/staff') && !from.pathname.startsWith('/staff/sign-in')) {
    return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
  }
  return '/staff'
}

export default function SignIn() {
  const { status, identity, error, signInWithSso, signInDev, signOut } = useStaff()
  const location = useLocation()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    document.title = 'Sign in · InfraAlert staff'
  }, [])

  if (status === 'signed_in') {
    return <Navigate to={destination(location.state)} replace />
  }

  const busy = pending || status === 'loading'
  const run = async (fn) => {
    setPending(true)
    try {
      await fn()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink text-white">
      <div className="lane-strip" aria-hidden="true" />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-rise-in">
          <div className="mb-6 flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <div>
              <p className="text-xl font-black leading-none tracking-tight">
                Infra<span className="text-signal-400">Alert</span>
              </p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-sign text-asphalt-400">Control room</p>
            </div>
          </div>

          <section className="rounded-xl border-2 border-ink bg-white p-6 text-ink shadow-plate">
            {status === 'not_staff' ? (
              <NotStaff identity={identity} onSignOut={() => run(signOut)} busy={pending} />
            ) : (
              <>
                <h1 className="text-2xl font-black">Staff sign-in</h1>
                {config.staffAuth === 'dev' ? (
                  <DevSignIn busy={busy} onSignIn={(email) => run(() => signInDev(email))} />
                ) : (
                  <>
                    <p className="mt-1.5 text-sm text-asphalt-500">
                      For city public works staff. You&apos;ll continue on the city&apos;s sign-in page.
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-6 w-full text-base"
                      disabled={busy}
                      aria-busy={busy}
                      onClick={() => run(signInWithSso)}
                    >
                      {busy ? 'Signing you in…' : 'Sign in with city account'}
                      {!busy && <ArrowRight size={18} aria-hidden="true" />}
                    </button>
                  </>
                )}
                {error && (
                  <p role="alert" className="field-error mt-4">
                    <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                    {error}
                  </p>
                )}
              </>
            )}
          </section>

          <p className="mt-6 text-center text-xs text-asphalt-400">
            Reporting a problem? You don&apos;t need an account:{' '}
            <a href="/" className="font-bold text-white underline decoration-signal-400 decoration-2 underline-offset-4">
              report an issue
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  )
}

/** @param {{ busy: boolean, onSignIn: (email: string) => void }} props */
function DevSignIn({ busy, onSignIn }) {
  const [email, setEmail] = useState('')
  return (
    <div className="mt-3">
      <p className="tag border-dashed">Development sign-in</p>
      <p className="mt-2 text-sm text-asphalt-500">
        Signs in as a seeded staff member. Only works against a backend running in dev mode
        (<code className="font-mono text-xs">python -m infraalert.cli seed-dev</code>).
      </p>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSignIn(email)
        }}
      >
        <label htmlFor="dev-email" className="label">
          Staff email
        </label>
        <input
          id="dev-email"
          type="email"
          className="input"
          autoComplete="email"
          placeholder="dispatcher@dev.local"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button type="submit" className="btn-primary mt-4 w-full" disabled={busy} aria-busy={busy}>
          {busy ? 'Signing you in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-6 border-t border-concrete-200 pt-4">
        <p className="section-title">Seeded accounts</p>
        <ul className="mt-2 grid gap-2">
          {DEV_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                className="btn-secondary w-full justify-between"
                disabled={busy}
                onClick={() => onSignIn(account.email)}
              >
                <span>Sign in as {account.role}</span>
                <span className="font-mono text-xs font-normal text-asphalt-500">{account.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * @param {{ identity: { email: string | null, name: string | null } | null, onSignOut: () => void, busy: boolean }} props
 */
function NotStaff({ identity, onSignOut, busy }) {
  const who = identity?.email || identity?.name
  return (
    <div>
      <h1 className="text-2xl font-black">You don&apos;t have staff access yet</h1>
      {who && (
        <p className="mt-3 text-sm">
          Signed in as <span className="readout">{who}</span>
        </p>
      )}
      <p className="mt-3 text-sm text-asphalt-600">
        Your sign-in worked, but this account isn&apos;t on InfraAlert&apos;s staff list. Ask an admin to
        invite you with this email address. Once they have, sign in again and you&apos;ll go straight in.
      </p>
      <button type="button" className="btn-secondary mt-6 w-full" onClick={onSignOut} disabled={busy}>
        <LogOut size={18} aria-hidden="true" />
        Sign out
      </button>
    </div>
  )
}
