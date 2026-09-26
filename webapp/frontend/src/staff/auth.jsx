/**
 * Staff sign-in state (ADR 0007).
 *
 * useStaff() returns:
 *   status: 'loading' | 'signed_out' | 'signed_in' | 'not_staff'
 *   staff: Me | null            (from GET /api/staff/me once signed in)
 *   signInWithSso(): Promise<void>
 *   signInDev(email): Promise<void>   (config.staffAuth === 'dev' only)
 *   signOut(): Promise<void>
 * and, for the sign-in page:
 *   identity: { email: string | null, name: string | null } | null   who is signed in
 *     to the identity provider (also set while not_staff, so the page can say who)
 *   error: string | null        the last sign-in problem, in plain words
 *
 * Sign-in functions never reject: problems land in `error`.
 *
 * Two modes (config.staffAuth):
 * - identity_platform: Google Identity Platform (Firebase Auth) with the city's OIDC
 *   provider. The SDK is imported lazily, so it only loads for staff.
 * - dev: the backend accepts `dev:<email>` as a token for a seeded staff member.
 *   The token lives in sessionStorage.
 *
 * Either way, access and role come from GET /api/staff/me: 403 means "signed in,
 * but not staff", 401 means signed out.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client.js'
import { config } from '../config.js'
import { configureStaffApi, getMe } from './api.js'

/** @typedef {import('./api.js').Me} Me */
/** @typedef {'loading' | 'signed_out' | 'signed_in' | 'not_staff'} StaffStatus */
/** @typedef {{ email: string | null, name: string | null }} Identity */
/**
 * @typedef {{
 *   status: StaffStatus, staff: Me | null, identity: Identity | null, error: string | null,
 *   signInWithSso: () => Promise<void>, signInDev: (email: string) => Promise<void>,
 *   signOut: () => Promise<void>,
 * }} StaffAuth
 */

export const DEV_TOKEN_KEY = 'infraalert.staff.devToken'

const StaffAuthContext = createContext(/** @type {StaffAuth | null} */ (null))

const devStore = {
  read() {
    try {
      return window.sessionStorage.getItem(DEV_TOKEN_KEY)
    } catch {
      return null
    }
  },
  write(token) {
    try {
      window.sessionStorage.setItem(DEV_TOKEN_KEY, token)
    } catch {
      // storage unavailable: the session just won't survive a reload
    }
  },
  clear() {
    try {
      window.sessionStorage.removeItem(DEV_TOKEN_KEY)
    } catch {
      // nothing to clear
    }
  },
}

/** Loads and initialises the Firebase SDK once per provider. */
async function loadFirebase() {
  const [appMod, authMod] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config.firebase)
  return { auth: authMod.getAuth(app), authMod }
}

const QUIET_FIREBASE_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])
const REDIRECT_FIREBASE_ERRORS = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'])

/** Plain words for a sign-in failure. */
function describeError(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return "That sign-in wasn't accepted. Try again."
    return "We couldn't check your staff access. Try again in a moment."
  }
  const code = err?.code
  if (code === 'auth/network-request-failed') return "We couldn't reach the sign-in service. Check your connection and try again."
  if (code === 'auth/invalid-api-key' || code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed')
    return "Staff sign-in isn't set up correctly. Contact your administrator."
  if (code === 'auth/user-disabled') return 'Your city account is disabled.'
  if (err instanceof TypeError) return "We couldn't reach the server. Check your connection and try again."
  return 'Sign-in failed. Try again.'
}

/** @param {{ children: import('react').ReactNode }} props */
export function StaffAuthProvider({ children }) {
  const [state, setState] = useState(
    /** @type {{ status: StaffStatus, staff: Me | null, identity: Identity | null, error: string | null }} */ ({
      status: 'loading',
      staff: null,
      identity: null,
      error: null,
    }),
  )

  const devTokenRef = useRef(/** @type {string | null} */ (null))
  const userRef = useRef(/** @type {any} */ (null)) // Firebase user
  const firebaseRef = useRef(/** @type {Promise<{ auth: any, authMod: any }> | null} */ (null))
  // Bumped on every sign-in or sign-out, so a stale /me answer is ignored.
  const sessionRef = useRef(0)
  const statusRef = useRef(state.status)
  statusRef.current = state.status

  const firebase = useCallback(() => {
    if (!firebaseRef.current) {
      firebaseRef.current = loadFirebase()
      firebaseRef.current.catch(() => {
        firebaseRef.current = null // allow a retry
      })
    }
    return firebaseRef.current
  }, [])

  /** Forget every credential locally (and at Firebase), then show signed_out. */
  const clearSession = useCallback(
    async (error = null) => {
      sessionRef.current += 1
      devTokenRef.current = null
      devStore.clear()
      const hadUser = Boolean(userRef.current)
      userRef.current = null
      setState({ status: 'signed_out', staff: null, identity: null, error })
      if (config.staffAuth === 'identity_platform' && hadUser && firebaseRef.current) {
        try {
          const { auth, authMod } = await firebaseRef.current
          await authMod.signOut(auth)
        } catch {
          // already signed out locally
        }
      }
    },
    [],
  )

  /** Ask the backend who this identity is on the staff side. */
  const loadMe = useCallback(
    async (/** @type {Identity} */ identity) => {
      const session = ++sessionRef.current
      setState({ status: 'loading', staff: null, identity, error: null })
      try {
        const me = await getMe()
        if (session !== sessionRef.current) return
        setState({ status: 'signed_in', staff: me, identity, error: null })
      } catch (err) {
        if (session !== sessionRef.current) return
        if (err instanceof ApiError && err.status === 403) {
          setState({ status: 'not_staff', staff: null, identity, error: null })
          return
        }
        await clearSession(describeError(err))
      }
    },
    [clearSession],
  )

  // Register how the API gets a token, and what a 401 means. Exactly once, and in a
  // layout effect so it happens before any page's data effects run.
  const configuredRef = useRef(false)
  useLayoutEffect(() => {
    if (configuredRef.current) return
    configuredRef.current = true
    configureStaffApi(
      async () => {
        if (config.staffAuth === 'dev') return devTokenRef.current
        return userRef.current ? userRef.current.getIdToken() : null
      },
      () => {
        if (statusRef.current === 'signed_out') return
        clearSession('Your session ended. Sign in again to continue.')
      },
    )
  }, [clearSession])

  // Restore any existing session on load.
  useEffect(() => {
    if (config.staffAuth === 'dev') {
      const token = devStore.read()
      if (token?.startsWith('dev:')) {
        devTokenRef.current = token
        loadMe({ email: token.slice(4), name: null })
      } else {
        setState((s) => ({ ...s, status: 'signed_out' }))
      }
      return undefined
    }

    let cancelled = false
    let unsubscribe = () => {}
    firebase()
      .then(({ auth, authMod }) => {
        if (cancelled) return
        // Finishes a sign-in that fell back to a full-page redirect.
        authMod.getRedirectResult(auth).catch((err) => {
          if (!cancelled && !QUIET_FIREBASE_ERRORS.has(err?.code)) {
            setState((s) => ({ ...s, error: describeError(err) }))
          }
        })
        // Fires on sign-in, sign-out and every token refresh.
        unsubscribe = authMod.onIdTokenChanged(auth, (user) => {
          const previous = userRef.current
          userRef.current = user
          if (!user) {
            if (previous || statusRef.current === 'loading') {
              sessionRef.current += 1
              setState((s) => ({ status: 'signed_out', staff: null, identity: null, error: s.error }))
            }
            return
          }
          if (previous?.uid === user.uid) return // just a refreshed token
          loadMe({ email: user.email ?? null, name: user.displayName ?? null })
        })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'signed_out', staff: null, identity: null, error: describeError(err) })
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [firebase, loadMe])

  const signInWithSso = useCallback(async () => {
    setState((s) => ({ ...s, error: null }))
    try {
      const { auth, authMod } = await firebase()
      const provider = new authMod.OAuthProvider(config.staffSignInProvider)
      try {
        // onIdTokenChanged picks up the new user and loads /me.
        await authMod.signInWithPopup(auth, provider)
      } catch (err) {
        if (REDIRECT_FIREBASE_ERRORS.has(err?.code)) {
          await authMod.signInWithRedirect(auth, provider)
          return
        }
        throw err
      }
    } catch (err) {
      if (QUIET_FIREBASE_ERRORS.has(err?.code)) return
      setState((s) => ({ ...s, error: describeError(err) }))
    }
  }, [firebase])

  const signInDev = useCallback(
    async (/** @type {string} */ email) => {
      const clean = email.trim().toLowerCase()
      if (!clean) {
        setState((s) => ({ ...s, error: 'Enter a staff email address.' }))
        return
      }
      const token = `dev:${clean}`
      devTokenRef.current = token
      devStore.write(token)
      await loadMe({ email: clean, name: null })
    },
    [loadMe],
  )

  const signOut = useCallback(() => clearSession(null), [clearSession])

  const value = useMemo(
    () => ({ ...state, signInWithSso, signInDev, signOut }),
    [state, signInWithSso, signInDev, signOut],
  )
  return <StaffAuthContext.Provider value={value}>{children}</StaffAuthContext.Provider>
}

/** @returns {StaffAuth} */
export function useStaff() {
  const value = useContext(StaffAuthContext)
  if (!value) throw new Error('useStaff() must be used inside <StaffAuthProvider>')
  return value
}
