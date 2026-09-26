import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client.js'

const mocks = vi.hoisted(() => ({
  config: { staffAuth: 'dev', firebase: {}, staffSignInProvider: '' },
  getMe: vi.fn(),
  configureStaffApi: vi.fn(),
}))
vi.mock('../config.js', () => ({ config: mocks.config }))
vi.mock('./api.js', () => ({ configureStaffApi: mocks.configureStaffApi, getMe: mocks.getMe }))
vi.mock('./pages/Queue.jsx', () => ({ default: () => <h1>Queue page</h1> }))
vi.mock('./pages/Incident.jsx', () => ({
  default: function Incident() {
    return <h1>Incident {useParams().id}</h1>
  },
}))
vi.mock('./pages/Teams.jsx', () => ({ default: () => <h1>Teams page</h1> }))
vi.mock('./pages/Members.jsx', () => ({ default: () => <h1>Members page</h1> }))
vi.mock('./pages/Places.jsx', () => ({ default: () => <h1>Places page</h1> }))

import StaffApp from './StaffApp.jsx'
import { DEV_TOKEN_KEY } from './auth.jsx'

const PEOPLE = {
  dispatcher: { id: '1', email: 'dispatcher@dev.local', display_name: 'Dee Dispatcher', role: 'dispatcher' },
  supervisor: { id: '2', email: 'supervisor@dev.local', display_name: 'Sam Supervisor', role: 'supervisor' },
  admin: { id: '3', email: 'admin@dev.local', display_name: 'Ada Admin', role: 'admin' },
}

function signedInAs(role) {
  sessionStorage.setItem(DEV_TOKEN_KEY, `dev:${PEOPLE[role].email}`)
  mocks.getMe.mockResolvedValue(PEOPLE[role])
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/staff/*" element={<StaffApp />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The desktop sidebar nav (the mobile menu's copy only exists while open). */
const sidebarNav = () => screen.getAllByRole('navigation', { name: 'Staff' })[0]

beforeEach(() => {
  sessionStorage.clear()
  mocks.config.staffAuth = 'dev'
  mocks.getMe.mockReset()
  mocks.configureStaffApi.mockReset()
})

describe('guards', () => {
  it('shows a quiet loading screen while checking who is signed in', () => {
    signedInAs('dispatcher')
    mocks.getMe.mockReturnValue(new Promise(() => {}))
    renderAt('/staff')
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText('Queue page')).not.toBeInTheDocument()
  })

  it('sends signed-out visitors to sign in, then back to the page they wanted', async () => {
    renderAt('/staff/incidents/42')
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()

    mocks.getMe.mockResolvedValue(PEOPLE.dispatcher)
    await userEvent.click(screen.getByRole('button', { name: /Sign in as Dispatcher/ }))

    expect(await screen.findByRole('heading', { name: 'Incident 42' })).toBeInTheDocument()
    expect(document.title).toBe('Incident · InfraAlert staff')
  })

  it('shows the not-staff explanation instead of the app', async () => {
    sessionStorage.setItem(DEV_TOKEN_KEY, 'dev:stranger@dev.local')
    mocks.getMe.mockRejectedValue(new ApiError(403, 'not_staff'))
    renderAt('/staff')
    expect(await screen.findByText('stranger@dev.local')).toBeInTheDocument()
    expect(screen.getByText(/ask an admin to invite you/i)).toBeInTheDocument()
    expect(screen.queryByText('Queue page')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
  })

  it('tells a dispatcher they have no access to Teams, inside the layout', async () => {
    signedInAs('dispatcher')
    renderAt('/staff/teams')
    expect(await screen.findByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument()
    expect(screen.queryByText('Teams page')).not.toBeInTheDocument()
    expect(sidebarNav()).toBeInTheDocument()
  })

  it('lets a supervisor into Teams but not Staff', async () => {
    signedInAs('supervisor')
    const { unmount } = renderAt('/staff/teams')
    expect(await screen.findByRole('heading', { name: 'Teams page' })).toBeInTheDocument()
    expect(document.title).toBe('Teams · InfraAlert staff')
    unmount()

    renderAt('/staff/members')
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
  })

  it('lets an admin into Staff', async () => {
    signedInAs('admin')
    renderAt('/staff/members')
    expect(await screen.findByRole('heading', { name: 'Members page' })).toBeInTheDocument()
  })

  it('keeps Places for admins only', async () => {
    signedInAs('supervisor')
    const { unmount } = renderAt('/staff/places')
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByText('Places page')).not.toBeInTheDocument()
    expect(within(sidebarNav()).queryByRole('link', { name: 'Places' })).not.toBeInTheDocument()
    unmount()

    signedInAs('admin')
    renderAt('/staff/places')
    expect(await screen.findByRole('heading', { name: 'Places page' })).toBeInTheDocument()
    expect(document.title).toBe('Places · InfraAlert staff')
    expect(within(sidebarNav()).getByRole('link', { name: 'Places' })).toHaveAttribute('aria-current', 'page')
  })

  it('signs out from the sidebar', async () => {
    signedInAs('dispatcher')
    renderAt('/staff')
    await screen.findByRole('heading', { name: 'Queue page' })
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
    expect(sessionStorage.getItem(DEV_TOKEN_KEY)).toBeNull()
  })
})

describe('layout', () => {
  it.each([
    ['dispatcher', ['Queue']],
    ['supervisor', ['Queue', 'Teams']],
    ['admin', ['Queue', 'Teams', 'Staff', 'Places']],
  ])('shows a %s the right nav items', async (role, labels) => {
    signedInAs(role)
    renderAt('/staff')
    await screen.findByRole('heading', { name: 'Queue page' })
    const links = within(sidebarNav()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(labels)
  })

  it('marks the current page and shows who is signed in', async () => {
    signedInAs('supervisor')
    renderAt('/staff/teams')
    await screen.findByRole('heading', { name: 'Teams page' })
    const nav = within(sidebarNav())
    expect(nav.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Queue' })).not.toHaveAttribute('aria-current')

    const sidebar = within(screen.getByRole('complementary'))
    expect(sidebar.getByText('Sam Supervisor')).toBeInTheDocument()
    expect(sidebar.getByText('Supervisor')).toBeInTheDocument()
  })

  it('keeps Queue marked on an incident page', async () => {
    signedInAs('dispatcher')
    renderAt('/staff/incidents/7')
    await screen.findByRole('heading', { name: 'Incident 7' })
    expect(within(sidebarNav()).getByRole('link', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
  })

  it('has a skip link to the main content', async () => {
    signedInAs('dispatcher')
    renderAt('/staff')
    await screen.findByRole('heading', { name: 'Queue page' })
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#staff-main')
    expect(document.getElementById('staff-main')).toContainElement(screen.getByText('Queue page'))
    expect(document.title).toBe('Queue · InfraAlert staff')
  })

  it('opens the mobile menu, traps focus in it, and closes with Escape', async () => {
    const user = userEvent.setup()
    signedInAs('admin')
    renderAt('/staff')
    await screen.findByRole('heading', { name: 'Queue page' })

    const menuButton = screen.getByRole('button', { name: 'Open menu' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(menuButton)

    const dialog = screen.getByRole('dialog', { name: 'Menu' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    const close = within(dialog).getByRole('button', { name: 'Close menu' })
    expect(close).toHaveFocus()
    expect(within(dialog).getAllByRole('link').map((l) => l.textContent)).toEqual(['Queue', 'Teams', 'Staff', 'Places'])

    // Shift+Tab from the first control wraps to the last; Tab from the last wraps back.
    await user.tab({ shift: true })
    const signOut = within(dialog).getByRole('button', { name: 'Sign out' })
    expect(signOut).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()
  })

  it('closes the mobile menu after choosing a page', async () => {
    const user = userEvent.setup()
    signedInAs('supervisor')
    renderAt('/staff')
    await screen.findByRole('heading', { name: 'Queue page' })
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Teams' }))
    expect(await screen.findByRole('heading', { name: 'Teams page' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
