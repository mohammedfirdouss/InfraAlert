import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../api/client.js'

vi.mock('../api.js', () => ({
  getMembers: vi.fn(),
  inviteMember: vi.fn(),
  updateMember: vi.fn(),
}))
vi.mock('../auth.jsx', () => ({ useStaff: vi.fn() }))

import { getMembers, inviteMember, updateMember } from '../api.js'
import { useStaff } from '../auth.jsx'
import Members from './Members.jsx'

const MEMBERS = [
  { id: 'm1', email: 'ada@city.gov', display_name: 'Ada Admin', role: 'admin', status: 'active', created_at: '2026-01-05T09:00:00Z' },
  { id: 'm2', email: 'bo@city.gov', display_name: 'Bo Dispatch', role: 'dispatcher', status: 'active', created_at: '2026-02-01T09:00:00Z' },
  { id: 'm3', email: 'cy@city.gov', display_name: 'Cy New', role: 'supervisor', status: 'invited', created_at: '2026-09-20T09:00:00Z' },
  { id: 'm4', email: 'di@city.gov', display_name: 'Di Gone', role: 'dispatcher', status: 'deactivated', created_at: '2025-11-11T09:00:00Z' },
  { id: 'm5', email: 'eve@city.gov', display_name: 'Eve Admin', role: 'admin', status: 'active', created_at: '2026-03-01T09:00:00Z' },
]

function renderPage() {
  render(<Members />)
  return userEvent.setup()
}

const row = (name) => screen.getByRole('listitem', { name })
const names = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))

beforeEach(() => {
  vi.mocked(getMembers).mockReset().mockResolvedValue(structuredClone(MEMBERS))
  vi.mocked(inviteMember).mockReset()
  vi.mocked(updateMember).mockReset()
  useStaff.mockReturnValue({
    status: 'signed_in',
    staff: { id: 'm1', email: 'ada@city.gov', display_name: 'Ada Admin', role: 'admin' },
  })
})

describe('staff list', () => {
  it('shows each member with role, status and date', async () => {
    renderPage()
    const bo = await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    expect(within(bo).getByText('bo@city.gov')).toBeInTheDocument()
    expect(within(bo).getByText('Dispatcher', { selector: '.tag' })).toBeInTheDocument()
    expect(within(bo).getByText('Active')).toBeInTheDocument()
    expect(within(bo).getByText(/2026/, { selector: 'time' })).toHaveAttribute('dateTime', MEMBERS[1].created_at)

    expect(within(row('Cy New')).getByText('Invited').className).toContain('border-dashed')
    expect(within(row('Di Gone')).getByText('Deactivated')).toBeInTheDocument()
    expect(within(row('Di Gone')).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
  })

  it('filters by status', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    expect(names()).toHaveLength(5)

    await user.click(screen.getByRole('button', { name: /^Invited/ }))
    expect(screen.getByRole('button', { name: /^Invited/ })).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['Cy New'])

    await user.click(screen.getByRole('button', { name: /^Deactivated/ }))
    expect(names()).toEqual(['Di Gone'])

    await user.click(screen.getByRole('button', { name: /^Active/ }))
    expect(names()).toEqual(['Ada Admin', 'Bo Dispatch', 'Eve Admin'])

    await user.click(screen.getByRole('button', { name: /^All/ }))
    expect(names()).toHaveLength(5)
  })

  it('shows an empty filter state', async () => {
    getMembers.mockResolvedValue(MEMBERS.filter((m) => m.status !== 'invited'))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    await user.click(screen.getByRole('button', { name: /^Invited/ }))
    expect(screen.getByText('No invited staff')).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    getMembers.mockRejectedValueOnce(new ApiError(503, null))
    const user = renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the staff list")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('listitem', { name: 'Bo Dispatch' })).toBeInTheDocument()
  })
})

describe('inviting', () => {
  it('adds the new person as Invited with the first-sign-in note', async () => {
    inviteMember.mockResolvedValue({
      id: 'm9', email: 'fay@city.gov', display_name: 'Fay Field', role: 'supervisor',
      status: 'invited', created_at: '2026-09-26T10:00:00Z',
    })
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })

    await user.type(screen.getByLabelText('Email'), ' fay@city.gov ')
    await user.type(screen.getByLabelText('Display name'), 'Fay Field')
    await user.selectOptions(screen.getByLabelText('Role'), 'supervisor')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect(inviteMember).toHaveBeenCalledWith({ email: 'fay@city.gov', display_name: 'Fay Field', role: 'supervisor' })
    const fay = await screen.findByRole('listitem', { name: 'Fay Field' })
    expect(within(fay).getByText('Invited')).toBeInTheDocument()
    expect(
      screen.getByText(/They'll get access the first time they sign in with this email through the city account\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Fay Field invited.')
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('validates the email and name inline', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    await user.type(screen.getByLabelText('Email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(screen.getByText('That doesn’t look like an email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter their name, as colleagues will see it.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('explains a duplicate on the email field', async () => {
    inviteMember.mockRejectedValue(new ApiError(409, 'already_staff'))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    await user.type(screen.getByLabelText('Email'), 'bo@city.gov')
    await user.type(screen.getByLabelText('Display name'), 'Bo Again')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    const email = screen.getByLabelText('Email')
    expect(await screen.findByText('This email already belongs to someone on the staff list.')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(/already belongs/)
    expect(names()).toHaveLength(5)
  })
})

describe('changing access', () => {
  it('changes a role', async () => {
    updateMember.mockResolvedValue({ ...MEMBERS[1], role: 'supervisor' })
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Bo Dispatch' })
    await user.selectOptions(screen.getByLabelText('Role for Bo Dispatch'), 'supervisor')

    expect(updateMember).toHaveBeenCalledWith('m2', { role: 'supervisor' })
    expect(await within(row('Bo Dispatch')).findByText('Supervisor', { selector: '.tag' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Bo Dispatch is now Supervisor.')
  })

  it('asks before deactivating, and can be cancelled', async () => {
    updateMember.mockResolvedValue({ ...MEMBERS[1], status: 'deactivated' })
    const user = renderPage()
    const bo = await screen.findByRole('listitem', { name: 'Bo Dispatch' })

    await user.click(within(bo).getByRole('button', { name: 'Deactivate' }))
    expect(updateMember).not.toHaveBeenCalled()
    const confirm = within(bo).getByRole('group', { name: 'Confirm deactivating Bo Dispatch' })
    expect(confirm).toHaveTextContent('They lose access to the staff dashboard')
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(within(bo).queryByRole('group')).not.toBeInTheDocument()

    await user.click(within(bo).getByRole('button', { name: 'Deactivate' }))
    await user.click(
      within(within(bo).getByRole('group')).getByRole('button', { name: 'Deactivate' }),
    )
    expect(updateMember).toHaveBeenCalledWith('m2', { active: false })
    expect(await within(row('Bo Dispatch')).findByText('Deactivated')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Bo Dispatch is deactivated.')
  })

  it('reactivates without asking', async () => {
    updateMember.mockResolvedValue({ ...MEMBERS[3], status: 'active' })
    const user = renderPage()
    const di = await screen.findByRole('listitem', { name: 'Di Gone' })
    await user.click(within(di).getByRole('button', { name: 'Reactivate' }))
    expect(updateMember).toHaveBeenCalledWith('m4', { active: true })
    expect(await within(row('Di Gone')).findByText('Active')).toBeInTheDocument()
  })

  it("guards the current user's own row", async () => {
    renderPage()
    const me = await screen.findByRole('listitem', { name: 'Ada Admin' })
    expect(within(me).getByText('You')).toBeInTheDocument()
    const role = within(me).getByLabelText('Role for Ada Admin')
    expect(role).toBeDisabled()
    expect(role).toHaveAccessibleDescription("You can't change your own role or access. Ask another admin.")
    expect(within(me).getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    expect(within(row('Eve Admin')).queryByText('You')).not.toBeInTheDocument()
  })

  it('explains last_admin in plain words and keeps the old role', async () => {
    updateMember.mockRejectedValue(new ApiError(409, 'last_admin'))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Eve Admin' })
    await user.selectOptions(screen.getByLabelText('Role for Eve Admin'), 'dispatcher')

    expect(
      await within(row('Eve Admin')).findByText(/This is the last active admin\. Make someone else an admin first/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Role for Eve Admin')).toHaveValue('admin')
  })

  it('explains cannot_change_own_access', async () => {
    updateMember.mockRejectedValue(new ApiError(409, 'cannot_change_own_access'))
    const user = renderPage()
    const eve = await screen.findByRole('listitem', { name: 'Eve Admin' })
    await user.click(within(eve).getByRole('button', { name: 'Deactivate' }))
    await user.click(within(within(eve).getByRole('group')).getByRole('button', { name: 'Deactivate' }))
    expect(await within(eve).findByText(/You can't lower your own role or remove your own access/)).toBeInTheDocument()
  })
})
