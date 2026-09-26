import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '../../api/client.js'

vi.mock('react-leaflet', () => import('../admin/leafletStandIn.jsx'))
vi.mock('../../map.js', () => ({
  tileLayer: { url: 'tiles/{z}/{x}/{y}.png', attribution: 'test' },
  markerIcon: {},
}))
vi.mock('../api.js', () => ({
  getTeams: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
}))
vi.mock('../auth.jsx', () => ({ useStaff: vi.fn() }))

import { createTeam, getTeams, updateTeam } from '../api.js'
import { useStaff } from '../auth.jsx'
import Teams from './Teams.jsx'

const BUSY_INCIDENT = '3f2a9c01-0000-4000-8000-000000000001'

const TEAMS = [
  {
    id: 't1',
    name: 'Roads North',
    skills: ['pothole', 'road_damage'],
    base_location: { lat: -1.28, lng: 36.81 },
    active: true,
    busy_with_incident_id: null,
  },
  {
    id: 't2',
    name: 'Water Crew',
    skills: ['water_leak'],
    base_location: { lat: -1.3, lng: 36.83 },
    active: true,
    busy_with_incident_id: BUSY_INCIDENT,
  },
  {
    id: 't3',
    name: 'Old Lights',
    skills: ['broken_streetlight'],
    base_location: { lat: -1.31, lng: 36.79 },
    active: false,
    busy_with_incident_id: null,
  },
]

function signInAs(role) {
  useStaff.mockReturnValue({
    status: 'signed_in',
    staff: { id: 'me', email: 'me@city.gov', display_name: 'Me', role },
  })
}

function renderPage() {
  render(
    <MemoryRouter>
      <Teams />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const row = (name) => screen.getByRole('listitem', { name })

beforeEach(() => {
  vi.mocked(getTeams).mockReset().mockResolvedValue(structuredClone(TEAMS))
  vi.mocked(createTeam).mockReset()
  vi.mocked(updateTeam).mockReset()
  signInAs('supervisor')
})

describe('Teams list', () => {
  it('shows each team with skills, status and base', async () => {
    renderPage()
    expect(await screen.findByRole('listitem', { name: 'Roads North' })).toBeInTheDocument()

    const roads = row('Roads North')
    expect(within(roads).getByText('Pothole')).toBeInTheDocument()
    expect(within(roads).getByText('Road damage')).toBeInTheDocument()
    expect(within(roads).getByText('Available')).toBeInTheDocument()
    expect(within(roads).getByText('-1.28000, 36.81000')).toBeInTheDocument()

    expect(within(row('Old Lights')).getByText('Inactive')).toBeInTheDocument()
    expect(within(row('Old Lights')).queryByText('Available')).not.toBeInTheDocument()
  })

  it('links a busy team to its incident', async () => {
    renderPage()
    const link = await within(await screen.findByRole('listitem', { name: 'Water Crew' })).findByRole('link', {
      name: /On INC 3F2A9C01/,
    })
    expect(link).toHaveAttribute('href', `/staff/incidents/${BUSY_INCIDENT}`)
  })

  it('shows a skeleton while loading, then an empty state', async () => {
    let resolve
    getTeams.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    expect(screen.getByText('Loading teams…')).toBeInTheDocument()
    resolve([])
    expect(await screen.findByText('No teams yet')).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    getTeams.mockRejectedValueOnce(new ApiError(500, null))
    const user = renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the teams")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('listitem', { name: 'Roads North' })).toBeInTheDocument()
    expect(getTeams).toHaveBeenCalledTimes(2)
  })

  it('links list and map by hover', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    const markers = () => screen.getAllByTestId('marker')

    await user.hover(row('Water Crew'))
    const water = markers().find((m) => m.dataset.title === 'Water Crew')
    const roads = markers().find((m) => m.dataset.title === 'Roads North')
    expect(water).toHaveAttribute('data-opacity', '1')
    expect(roads).toHaveAttribute('data-opacity', '0.45')

    await user.unhover(row('Water Crew'))
    await user.hover(within(roads).getByRole('button', { name: 'marker Roads North' }))
    expect(row('Roads North').className).toContain('bg-signal-100')
  })
})

describe('read-only for dispatchers', () => {
  it('hides create and edit controls', async () => {
    signInAs('dispatcher')
    renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    expect(screen.queryByRole('button', { name: /New team/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })
})

describe('creating a team', () => {
  it('validates inline before sending', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: /New team/ }))
    const dialog = screen.getByRole('dialog', { name: 'New team' })
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))

    expect(within(dialog).getByText('Give the team a name.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Pick at least one skill/)).toBeInTheDocument()
    expect(within(dialog).getByText("Set the team's base on the map.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(createTeam).not.toHaveBeenCalled()
  })

  it('sends name, skills, location and active, then lists the team', async () => {
    const created = {
      id: 't9',
      name: 'Sewer Squad',
      skills: ['water_leak', 'sewage'],
      base_location: { lat: -1.26, lng: 36.76 },
      active: true,
      busy_with_incident_id: null,
    }
    createTeam.mockResolvedValue(created)
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: /New team/ }))
    const dialog = screen.getByRole('dialog', { name: 'New team' })

    await user.type(within(dialog).getByLabelText('Name'), '  Sewer Squad ')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Sewage' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Water leak' }))
    await user.click(within(dialog).getByRole('button', { name: 'simulate map click' }))
    expect(within(dialog).getByText('-1.25000')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'simulate marker drag' }))
    expect(within(dialog).getByText('36.76000')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))

    expect(createTeam).toHaveBeenCalledWith({
      name: 'Sewer Squad',
      skills: ['water_leak', 'sewage'],
      base_location: { lat: -1.26, lng: 36.76 },
      active: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(row('Sewer Squad')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Team “Sewer Squad” created.')
  })

  it('shows a name conflict on the name field', async () => {
    createTeam.mockRejectedValue(new ApiError(409, 'team_name_taken'))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: /New team/ }))
    const dialog = screen.getByRole('dialog', { name: 'New team' })

    await user.type(within(dialog).getByLabelText('Name'), 'roads north')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Pothole' }))
    await user.click(within(dialog).getByRole('button', { name: 'Place at map centre' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }))

    const name = within(dialog).getByLabelText('Name')
    expect(await within(dialog).findByText(/Another team is already called “roads north”/)).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(/already called/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('editing a team', () => {
  it('sends only the changed fields', async () => {
    updateTeam.mockResolvedValue({ ...TEAMS[0], name: 'Roads North 2', skills: ['pothole'], warning: null })
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: 'Edit Roads North' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Roads North' })

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Roads North')
    expect(within(dialog).getByRole('checkbox', { name: 'Pothole' })).toBeChecked()
    expect(within(dialog).getByRole('switch', { name: /Active/ })).toBeChecked()

    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Roads North 2')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Road damage' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateTeam).toHaveBeenCalledWith('t1', { name: 'Roads North 2', skills: ['pothole'] })
    expect(await screen.findByRole('listitem', { name: 'Roads North 2' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Changes to “Roads North 2” saved.')
  })

  it('warns after deactivating a busy team', async () => {
    updateTeam.mockResolvedValue({
      ...TEAMS[1],
      active: false,
      warning: 'team_busy_until_assignment_ends',
    })
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Water Crew' })
    await user.click(screen.getByRole('button', { name: 'Edit Water Crew' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Water Crew' })
    await user.click(within(dialog).getByRole('switch', { name: /Active/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateTeam).toHaveBeenCalledWith('t2', { active: false })
    const warning = await screen.findByRole('alert')
    expect(warning).toHaveTextContent('Water Crew is now inactive but is still working on INC 3F2A9C01')
    expect(warning).toHaveTextContent('stays busy until that assignment ends')
    expect(within(warning).getByRole('link')).toHaveAttribute('href', `/staff/incidents/${BUSY_INCIDENT}`)
    // Both the busy link and the Inactive tag now show on the row.
    expect(within(row('Water Crew')).getByText('Inactive')).toBeInTheDocument()
  })

  it('closes without saving when nothing changed', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: 'Edit Roads North' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateTeam).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Roads North' })
    await user.click(screen.getByRole('button', { name: 'Edit Roads North' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
