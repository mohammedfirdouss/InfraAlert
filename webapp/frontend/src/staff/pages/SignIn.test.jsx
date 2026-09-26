import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { staffAuth: 'identity_platform' },
  auth: null,
}))
vi.mock('../../config.js', () => ({ config: mocks.config }))
vi.mock('../auth.jsx', () => ({ useStaff: () => mocks.auth }))

import SignIn from './SignIn.jsx'

function setAuth(overrides = {}) {
  mocks.auth = {
    status: 'signed_out',
    staff: null,
    identity: null,
    error: null,
    signInWithSso: vi.fn(async () => {}),
    signInDev: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  }
  return mocks.auth
}

function renderSignIn(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/staff/sign-in', state }]}>
      <Routes>
        <Route path="/staff/sign-in" element={<SignIn />} />
        <Route path="/staff" element={<p>Queue here</p>} />
        <Route path="/staff/incidents/:id" element={<p>Incident here</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.config.staffAuth = 'identity_platform'
  setAuth()
})

describe('SSO sign-in', () => {
  it('offers one city sign-in button that starts SSO', async () => {
    const auth = setAuth()
    renderSignIn()
    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
    expect(screen.queryByText('Development sign-in')).not.toBeInTheDocument()
    expect(document.title).toBe('Sign in · InfraAlert staff')

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with city account' }))

    expect(auth.signInWithSso).toHaveBeenCalledTimes(1)
  })

  it('shows sign-in errors inline', () => {
    setAuth({ error: "We couldn't reach the sign-in service." })
    renderSignIn()
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't reach the sign-in service.")
  })

  it('disables the button while signing in', () => {
    setAuth({ status: 'loading' })
    renderSignIn()
    expect(screen.getByRole('button', { name: /signing you in/i })).toBeDisabled()
  })
})

describe('development sign-in', () => {
  beforeEach(() => {
    mocks.config.staffAuth = 'dev'
  })

  it('signs in with a typed email', async () => {
    const auth = setAuth()
    renderSignIn()
    expect(screen.getByText('Development sign-in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with city account' })).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Staff email'), 'supervisor@dev.local')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(auth.signInDev).toHaveBeenCalledWith('supervisor@dev.local')
  })

  it.each([
    ['Dispatcher', 'dispatcher@dev.local'],
    ['Supervisor', 'supervisor@dev.local'],
    ['Admin', 'admin@dev.local'],
  ])('has a quick button for the seeded %s', async (role, email) => {
    const auth = setAuth()
    renderSignIn()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`Sign in as ${role}`) }))
    expect(auth.signInDev).toHaveBeenCalledWith(email)
  })
})

describe('not staff', () => {
  it('says who they are signed in as, explains, and offers sign out', async () => {
    const auth = setAuth({ status: 'not_staff', identity: { email: 'ana@city.gov', name: 'Ana' } })
    renderSignIn()

    expect(screen.getByText('ana@city.gov')).toBeInTheDocument()
    expect(screen.getByText(/ask an admin to invite you/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with city account' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('after sign-in', () => {
  it('goes to the page they originally wanted', () => {
    setAuth({ status: 'signed_in', staff: { role: 'dispatcher' } })
    renderSignIn({ from: { pathname: '/staff/incidents/42', search: '', hash: '' } })
    expect(screen.getByText('Incident here')).toBeInTheDocument()
  })

  it('goes to the queue by default', () => {
    setAuth({ status: 'signed_in', staff: { role: 'dispatcher' } })
    renderSignIn()
    expect(screen.getByText('Queue here')).toBeInTheDocument()
  })

  it('ignores a destination outside the staff app', () => {
    setAuth({ status: 'signed_in', staff: { role: 'dispatcher' } })
    renderSignIn({ from: { pathname: '/elsewhere' } })
    expect(screen.getByText('Queue here')).toBeInTheDocument()
  })
})
