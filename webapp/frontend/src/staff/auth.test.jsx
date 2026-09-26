import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client.js'

const mocks = vi.hoisted(() => ({
  config: {
    staffAuth: 'dev',
    firebase: { apiKey: 'key', authDomain: 'city.firebaseapp.com', projectId: 'city' },
    staffSignInProvider: 'oidc.city-sso',
  },
  configureStaffApi: vi.fn(),
  getMe: vi.fn(),
  fb: { listener: null, auth: { name: 'auth' } },
}))

vi.mock('../config.js', () => ({ config: mocks.config }))
vi.mock('./api.js', () => ({ configureStaffApi: mocks.configureStaffApi, getMe: mocks.getMe }))

const appMod = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: 'app' })),
  getApps: vi.fn(() => []),
  getApp: vi.fn(),
}))
const authMod = vi.hoisted(() => ({
  getAuth: vi.fn(),
  OAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  onIdTokenChanged: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('firebase/app', () => appMod)
vi.mock('firebase/auth', () => authMod)

import { DEV_TOKEN_KEY, StaffAuthProvider, useStaff } from './auth.jsx'

const DISPATCHER = { id: 's1', email: 'dispatcher@dev.local', display_name: 'Dee Dispatcher', role: 'dispatcher' }
const firebaseUser = {
  uid: 'u1',
  email: 'ana@city.gov',
  displayName: 'Ana',
  getIdToken: vi.fn(async () => 'id-token-123'),
}

function renderAuth() {
  return renderHook(() => useStaff(), { wrapper: StaffAuthProvider })
}

/** The (getToken, onSignedOut) pair the provider registered. */
function registered() {
  expect(mocks.configureStaffApi).toHaveBeenCalledTimes(1)
  const [getToken, onSignedOut] = mocks.configureStaffApi.mock.calls[0]
  return { getToken, onSignedOut }
}

beforeEach(() => {
  sessionStorage.clear()
  mocks.config.staffAuth = 'dev'
  mocks.configureStaffApi.mockReset()
  mocks.getMe.mockReset()
  mocks.fb.listener = null

  authMod.getAuth.mockReset().mockReturnValue(mocks.fb.auth)
  authMod.OAuthProvider.mockReset().mockImplementation(function OAuthProvider(id) {
    this.providerId = id
  })
  authMod.signInWithPopup.mockReset().mockImplementation(async () => {
    mocks.fb.listener(firebaseUser)
    return { user: firebaseUser }
  })
  authMod.signInWithRedirect.mockReset().mockResolvedValue(undefined)
  authMod.getRedirectResult.mockReset().mockResolvedValue(null)
  authMod.onIdTokenChanged.mockReset().mockImplementation((_auth, callback) => {
    mocks.fb.listener = callback
    queueMicrotask(() => callback(null)) // Firebase reports the initial user asynchronously
    return () => {}
  })
  authMod.signOut.mockReset().mockImplementation(async () => mocks.fb.listener?.(null))
})

describe('dev sign-in', () => {
  it('starts signed out, then signs in with a dev token and loads /me', async () => {
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    await act(() => result.current.signInDev(' Dispatcher@dev.local '))

    expect(result.current.status).toBe('signed_in')
    expect(result.current.staff).toEqual(DISPATCHER)
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBe('dev:dispatcher@dev.local')
    await expect(registered().getToken()).resolves.toBe('dev:dispatcher@dev.local')
  })

  it('restores the session from sessionStorage on load', async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, 'dev:dispatcher@dev.local')
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('signed_in'))
    expect(mocks.getMe).toHaveBeenCalledTimes(1)
  })

  it('a 403 from /me means signed in but not staff, keeping who they are', async () => {
    mocks.getMe.mockRejectedValue(new ApiError(403, 'not_staff'))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    await act(() => result.current.signInDev('stranger@dev.local'))

    expect(result.current.status).toBe('not_staff')
    expect(result.current.staff).toBeNull()
    expect(result.current.identity.email).toBe('stranger@dev.local')
  })

  it('a 401 from /me signs out with an explanation', async () => {
    mocks.getMe.mockRejectedValue(new ApiError(401, 'invalid_token'))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    await act(() => result.current.signInDev('dispatcher@dev.local'))

    expect(result.current.status).toBe('signed_out')
    expect(result.current.error).toMatch(/wasn't accepted/)
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBeNull()
  })

  it('a 401 on a later API call signs out and forgets the token', async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, 'dev:dispatcher@dev.local')
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_in'))

    act(() => registered().onSignedOut())

    expect(result.current.status).toBe('signed_out')
    expect(result.current.staff).toBeNull()
    expect(result.current.error).toMatch(/session ended/)
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBeNull()
    await expect(registered().getToken()).resolves.toBeNull()
  })

  it('sign out clears the stored token', async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, 'dev:dispatcher@dev.local')
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_in'))

    await act(() => result.current.signOut())

    expect(result.current.status).toBe('signed_out')
    expect(result.current.error).toBeNull()
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBeNull()
    await expect(registered().getToken()).resolves.toBeNull()
  })

  it('registers with the API exactly once across re-renders', async () => {
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result, rerender } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))
    await act(() => result.current.signInDev('dispatcher@dev.local'))
    rerender()
    expect(mocks.configureStaffApi).toHaveBeenCalledTimes(1)
  })

  it('works when sessionStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))
    await act(() => result.current.signInDev('dispatcher@dev.local'))
    expect(result.current.status).toBe('signed_in')
  })
})

describe('identity_platform sign-in', () => {
  beforeEach(() => {
    mocks.config.staffAuth = 'identity_platform'
  })

  it('initialises Firebase with the configured project and starts signed out', async () => {
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))
    expect(appMod.initializeApp).toHaveBeenCalledWith(mocks.config.firebase)
    expect(authMod.getRedirectResult).toHaveBeenCalledWith(mocks.fb.auth)
  })

  it('signs in with the SSO popup, then loads /me with the ID token', async () => {
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    await act(() => result.current.signInWithSso())

    expect(authMod.OAuthProvider).toHaveBeenCalledWith('oidc.city-sso')
    expect(authMod.signInWithPopup).toHaveBeenCalledWith(mocks.fb.auth, expect.objectContaining({ providerId: 'oidc.city-sso' }))
    await waitFor(() => expect(result.current.status).toBe('signed_in'))
    expect(result.current.staff).toEqual(DISPATCHER)
    expect(result.current.identity).toEqual({ email: 'ana@city.gov', name: 'Ana' })
    await expect(registered().getToken()).resolves.toBe('id-token-123')
  })

  it('falls back to a redirect when the popup is blocked', async () => {
    authMod.signInWithPopup.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    await act(() => result.current.signInWithSso())

    expect(authMod.signInWithRedirect).toHaveBeenCalledWith(mocks.fb.auth, expect.objectContaining({ providerId: 'oidc.city-sso' }))
    expect(result.current.error).toBeNull()
  })

  it('picks up a user returning from the redirect', async () => {
    mocks.getMe.mockResolvedValue(DISPATCHER)
    authMod.onIdTokenChanged.mockImplementation((_auth, callback) => {
      mocks.fb.listener = callback
      queueMicrotask(() => callback(firebaseUser))
      return () => {}
    })
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_in'))
  })

  it('does not reload /me on a token refresh', async () => {
    mocks.getMe.mockResolvedValue(DISPATCHER)
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))
    await act(() => result.current.signInWithSso())
    await waitFor(() => expect(result.current.status).toBe('signed_in'))

    act(() => mocks.fb.listener({ ...firebaseUser }))

    expect(mocks.getMe).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('signed_in')
  })

  it('shows popup errors but stays quiet when the person closes the popup', async () => {
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))

    authMod.signInWithPopup.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }))
    await act(() => result.current.signInWithSso())
    expect(result.current.error).toBeNull()

    authMod.signInWithPopup.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))
    await act(() => result.current.signInWithSso())
    expect(result.current.error).toMatch(/couldn't reach the sign-in service/)
  })

  it('not_staff keeps the Firebase identity until sign out', async () => {
    mocks.getMe.mockRejectedValue(new ApiError(403, 'not_staff'))
    const { result } = renderAuth()
    await waitFor(() => expect(result.current.status).toBe('signed_out'))
    await act(() => result.current.signInWithSso())
    await waitFor(() => expect(result.current.status).toBe('not_staff'))
    expect(result.current.identity.email).toBe('ana@city.gov')

    await act(() => result.current.signOut())

    expect(authMod.signOut).toHaveBeenCalledWith(mocks.fb.auth)
    expect(result.current.status).toBe('signed_out')
    expect(result.current.identity).toBeNull()
    await expect(registered().getToken()).resolves.toBeNull()
  })
})
