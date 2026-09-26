import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client.js'

vi.mock('../api.js', () => ({
  getIncident: vi.fn(),
  triage: vi.fn(),
  assign: vi.fn(),
  markOnSite: vi.fn(),
  resolve: vi.fn(),
  closeInvalid: vi.fn(),
  merge: vi.fn(),
  split: vi.fn(),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: () => <div data-testid="incident-pin" />,
  Tooltip: ({ children }) => <span>{children}</span>,
  CircleMarker: ({ children, eventHandlers }) =>
    eventHandlers?.click ? (
      <button type="button" data-testid="nearby-circle" onClick={eventHandlers.click}>
        {children}
      </button>
    ) : (
      <div data-testid="report-point">{children}</div>
    ),
}))

import * as api from '../api.js'
import Incident from './Incident.jsx'
import {
  BUSY_ELSEWHERE_ID,
  INCIDENT_ID,
  OTHER_ID,
  TEAMS,
  detail,
  report,
  response,
} from '../incident/testFixtures.js'

function renderPage(id = INCIDENT_ID) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[`/staff/incidents/${id}`]}>
      <Routes>
        <Route path="/staff/incidents/:id" element={<Incident />} />
        <Route path="/staff" element={<p>Queue page</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return user
}

const actionsPanel = () => screen.getByRole('complementary', { name: 'Actions' })

/** Load the page with one incident response, and wait for it to render. */
async function loadWith(data) {
  api.getIncident.mockResolvedValue(data)
  const user = renderPage()
  await screen.findByRole('heading', { level: 1 })
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Incident page: states', () => {
  it('shows a skeleton while loading', () => {
    api.getIncident.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading incident…')).toBeInTheDocument()
  })

  it('says when the incident does not exist', async () => {
    api.getIncident.mockRejectedValue(new ApiError(404, 'incident_not_found'))
    renderPage()
    expect(await screen.findByRole('heading', { name: "This incident doesn't exist" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to queue' })).toHaveAttribute('href', '/staff')
  })

  it('offers a retry after a load error', async () => {
    api.getIncident.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(response())
    const user = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: /Pothole/ })).toBeInTheDocument()
  })

  it('renders the header with the short reference, badges and team', async () => {
    await loadWith(response())
    expect(screen.getByText('INC 1A2B3C4D')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pothole')
    expect(screen.getByText('MEDIUM')).toBeInTheDocument()
    expect(screen.getByText('Triaged')).toBeInTheDocument()
    expect(screen.getByText('Suggested team').nextSibling).toHaveTextContent('Roads 1')
    expect(screen.getByRole('link', { name: /Back to queue/ })).toHaveAttribute('href', '/staff')
  })

  it('shows a merged incident with a link and no actions', async () => {
    await loadWith(
      response({ incident: detail({ merged_into_id: OTHER_ID }, { status: 'closed_duplicate' }) }),
    )
    const links = screen.getAllByRole('link', { name: 'INC 9F8E7D6C' })
    expect(links[0]).toHaveAttribute('href', `/staff/incidents/${OTHER_ID}`)
    expect(screen.getByText(/Merged into/)).toBeInTheDocument()
    const panel = actionsPanel()
    expect(within(panel).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('Incident page: actions per status', () => {
  const buttonNames = () =>
    within(actionsPanel())
      .queryAllByRole('button')
      .map((b) => b.textContent)

  it('new and unclassified: classify, correct; assign waits for a type', async () => {
    await loadWith(
      response({
        incident: detail({ priority_inputs: null, formula_version: null }, { status: 'new', issue_type: null, severity: null, priority_score: null }),
      }),
    )
    const names = buttonNames()
    expect(names).toContain('Save')
    expect(within(actionsPanel()).getByText(/Classify this incident first/)).toBeInTheDocument()
    expect(names).toContain('Merge into another incident…')
    expect(names).toContain('Close as invalid…')
    expect(names.some((n) => /on site|Resolve/.test(n))).toBe(false)
  })

  it('triaged: type, assign, merge, close; no progress actions', async () => {
    await loadWith(response())
    const names = buttonNames()
    expect(names).toContain('Save type')
    expect(names).toContain('Assign Roads 1')
    expect(names.some((n) => /on site|Resolve/.test(n))).toBe(false)
  })

  it('assigned: reassign, on site, resolve, merge, close; no triage', async () => {
    await loadWith(
      response({ incident: detail({}, { status: 'assigned', assigned_team: { id: TEAMS.roads1.id, name: 'Roads 1' } }) }),
    )
    const names = buttonNames()
    expect(names).toEqual(
      expect.arrayContaining(['Reassign', 'Mark Roads 1 on site', 'Resolve…', 'Merge into another incident…', 'Close as invalid…']),
    )
    expect(names).not.toContain('Save type')
  })

  it('on site: resolve, merge, close only', async () => {
    await loadWith(
      response({ incident: detail({}, { status: 'on_site', assigned_team: { id: TEAMS.roads1.id, name: 'Roads 1' } }) }),
    )
    const names = buttonNames()
    expect(names).toContain('Resolve…')
    expect(names.some((n) => /on site|Reassign|Save/.test(n))).toBe(false)
  })

  it('resolved: no actions', async () => {
    await loadWith(response({ incident: detail({ resolved_at: '2026-09-26T12:00:00Z' }, { status: 'resolved' }) }))
    expect(buttonNames()).toHaveLength(0)
    expect(within(actionsPanel()).getByText(/No further actions/)).toBeInTheDocument()
  })
})

describe('Incident page: triage', () => {
  it('pre-selects the type the system suggested most, labelled as a suggestion, and saves it', async () => {
    const reports = [
      report({ id: 'a', issue_type: 'water_leak' }),
      report({ id: 'b', issue_type: 'sewage' }),
      report({ id: 'c', issue_type: 'sewage' }),
    ]
    const user = await loadWith(
      response({
        incident: detail({ reports, priority_inputs: null }, { status: 'new', issue_type: null, severity: null, priority_score: null }),
      }),
    )
    const panel = actionsPanel()
    const sewage = within(panel).getByRole('radio', { name: /Sewage/ })
    expect(sewage).toBeChecked()
    expect(sewage.closest('label')).toHaveTextContent('Suggested by the system')

    api.triage.mockResolvedValue(null)
    await user.click(within(panel).getByRole('radio', { name: /Water leak/ }))
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    expect(api.triage).toHaveBeenCalledWith(INCIDENT_ID, 'water_leak')
    expect(await screen.findByText('Type set to Water leak.')).toBeInTheDocument()
    expect(api.getIncident).toHaveBeenCalledTimes(2)
  })
})

describe('Incident page: assign', () => {
  it('defaults to the suggested team, flags overrides and unskilled teams, and disables busy teams', async () => {
    const user = await loadWith(response())
    const panel = actionsPanel()
    expect(within(panel).getByRole('radio', { name: /Roads 1/ })).toBeChecked()
    expect(within(panel).getByRole('radio', { name: /Roads 1/ }).closest('label')).toHaveTextContent('Suggested')
    expect(within(panel).getByText('850 m')).toBeInTheDocument()
    expect(within(panel).queryByText(/overriding the suggestion/)).not.toBeInTheDocument()

    const busy = within(panel).getByRole('radio', { name: /Roads 3/ })
    expect(busy).toBeDisabled()
    expect(within(panel).getByRole('link', { name: 'On INC ABCDEF12' })).toHaveAttribute(
      'href',
      `/staff/incidents/${BUSY_ELSEWHERE_ID}`,
    )

    // Skilled and free first, busy last.
    const order = [...panel.querySelectorAll('input[name="team"]')]
      .map((r) => r.closest('label').querySelector('.font-bold').textContent)
    expect(order).toEqual(['Roads 1', 'Roads 2', 'Water 1', 'Roads 3'])

    await user.click(within(panel).getByRole('radio', { name: /Water 1/ }))
    expect(within(panel).getByText(/You're overriding the suggestion \(Roads 1\)/)).toBeInTheDocument()
    expect(within(panel).getByText(/Water 1 isn't skilled for pothole/)).toBeInTheDocument()

    api.assign.mockResolvedValue(null)
    await user.click(within(panel).getByRole('button', { name: 'Assign Water 1' }))
    expect(api.assign).toHaveBeenCalledWith(INCIDENT_ID, TEAMS.water1.id)
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Water 1 assigned to INC 1A2B3C4D.')
  })

  it('explains team_busy in plain words and refetches', async () => {
    const user = await loadWith(response())
    api.assign.mockRejectedValue(new ApiError(409, 'team_busy'))
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Assign Roads 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Roads 1 was just assigned elsewhere. Pick another team.')
    await waitFor(() => expect(api.getIncident).toHaveBeenCalledTimes(2))
  })

  it('reassigns an assigned incident to another team', async () => {
    const teams = [
      { ...TEAMS.roads1, busy_with_incident_id: INCIDENT_ID },
      TEAMS.roads2,
      TEAMS.water1,
    ]
    const user = await loadWith(
      response({
        teams,
        incident: detail({}, { status: 'assigned', assigned_team: { id: TEAMS.roads1.id, name: 'Roads 1' } }),
      }),
    )
    const panel = actionsPanel()
    expect(within(panel).getByText(/is on this incident/)).toHaveTextContent('Roads 1 is on this incident.')
    await user.click(within(panel).getByRole('button', { name: 'Reassign' }))
    expect(within(panel).getByText('Assigned here')).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Roads 1/ })).toBeDisabled()

    await user.click(within(panel).getByRole('radio', { name: /Roads 2/ }))
    api.assign.mockResolvedValue(null)
    await user.click(within(panel).getByRole('button', { name: 'Reassign to Roads 2' }))
    expect(api.assign).toHaveBeenCalledWith(INCIDENT_ID, TEAMS.roads2.id)
  })
})

describe('Incident page: progress and closing', () => {
  const assigned = () =>
    response({ incident: detail({}, { status: 'assigned', assigned_team: { id: TEAMS.roads1.id, name: 'Roads 1' } }) })

  it('marks on site', async () => {
    const user = await loadWith(assigned())
    api.markOnSite.mockResolvedValue(null)
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Mark Roads 1 on site' }))
    expect(api.markOnSite).toHaveBeenCalledWith(INCIDENT_ID)
    expect(await screen.findByText('Marked on site.')).toBeInTheDocument()
  })

  it('resolves with an optional note', async () => {
    const user = await loadWith(assigned())
    api.resolve.mockResolvedValue(null)
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Resolve…' }))
    await user.type(screen.getByLabelText(/Resolution note/), 'Patched with cold mix')
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }))
    expect(api.resolve).toHaveBeenCalledWith(INCIDENT_ID, 'Patched with cold mix')
  })

  it('closes as invalid only with a reason, after an inline confirmation', async () => {
    const user = await loadWith(response())
    const confirmSpy = vi.spyOn(window, 'confirm')
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Close as invalid…' }))
    expect(screen.getByText("Close INC 1A2B3C4D as invalid? Citizens will see ‘Closed’.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close as invalid' }))
    expect(api.closeInvalid).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Reason/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument()

    api.closeInvalid.mockResolvedValue(null)
    await user.type(screen.getByLabelText(/Reason/), 'Prank report')
    await user.click(screen.getByRole('button', { name: 'Close as invalid' }))
    expect(api.closeInvalid).toHaveBeenCalledWith(INCIDENT_ID, 'Prank report')
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('Incident page: merge and split', () => {
  it('merges into a nearby incident after confirming', async () => {
    const user = await loadWith(response())
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Merge into another incident…' }))
    const option = within(actionsPanel()).getByRole('radio', { name: /INC 9F8E7D6C/ })
    expect(option.closest('label')).toHaveTextContent('40 m away · 3 reports')
    await user.click(option)
    expect(
      screen.getByText(/Merge INC 1A2B3C4D into INC 9F8E7D6C\? Its 2 reports move to INC 9F8E7D6C/),
    ).toBeInTheDocument()
    expect(api.merge).not.toHaveBeenCalled()

    api.merge.mockResolvedValue(null)
    await user.click(screen.getByRole('button', { name: 'Merge into INC 9F8E7D6C' }))
    expect(api.merge).toHaveBeenCalledWith(INCIDENT_ID, OTHER_ID)
  })

  it('picks a merge target from the map', async () => {
    const user = await loadWith(response())
    await user.click(screen.getByTestId('nearby-circle'))
    expect(within(actionsPanel()).getByRole('radio', { name: /INC 9F8E7D6C/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Merge into INC 9F8E7D6C' })).toBeInTheDocument()
  })

  it('merges by pasting an incident id', async () => {
    const user = await loadWith(response({ nearby: [] }))
    const pasted = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    await user.click(within(actionsPanel()).getByRole('button', { name: 'Merge into another incident…' }))
    await user.type(screen.getByLabelText('Or paste an incident ID'), pasted)
    await user.click(screen.getByRole('button', { name: 'Use' }))
    api.merge.mockResolvedValue(null)
    await user.click(screen.getByRole('button', { name: 'Merge into INC AAAAAAAA' }))
    expect(api.merge).toHaveBeenCalledWith(INCIDENT_ID, pasted)
  })

  it('splits the selected reports into a new incident and opens it', async () => {
    api.getIncident.mockResolvedValue(response())
    api.split.mockResolvedValue({ new_incident_id: OTHER_ID })
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[`/staff/incidents/${INCIDENT_ID}`]}>
        <Routes>
          <Route path="/staff/incidents/:id" element={<Incident />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('checkbox', { name: 'Select report 2 to move' }))
    await user.click(screen.getByRole('button', { name: 'Move 1 report to a new incident' }))
    expect(screen.getByText(/Move 1 report out of INC 1A2B3C4D into a new incident\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, move 1 report' }))
    expect(api.split).toHaveBeenCalledWith(INCIDENT_ID, ['r-2'])
    await waitFor(() => expect(api.getIncident).toHaveBeenLastCalledWith(OTHER_ID))
    expect(await screen.findByText('Moved 1 report to INC 9F8E7D6C.')).toBeInTheDocument()
  })

  it('will not split every report', async () => {
    const user = await loadWith(response())
    await user.click(screen.getByRole('checkbox', { name: 'Select report 1 to move' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select report 2 to move' }))
    expect(screen.getByText(/All reports are ticked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move 2 reports/ })).not.toBeInTheDocument()
  })

  it('has no split checkboxes for a single report', async () => {
    await loadWith(response({ incident: detail({ reports: [report()] }) }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('Incident page: priority, hints and activity', () => {
  it('breaks the priority down by component', async () => {
    await loadWith(
      response({
        incident: detail({
          priority_inputs: {
            ...detail().priority_inputs,
            floor_applied: true,
          },
        }),
      }),
    )
    const panel = screen.getByRole('region', { name: 'Why this priority' })
    expect(within(panel).getByText('Formula v1')).toBeInTheDocument()
    expect(within(panel).getByTestId('bar-hazard')).toHaveStyle({ width: '21%' })
    expect(within(panel).getByTestId('bar-type')).toHaveStyle({ width: '15%' })
    expect(within(panel).getByRole('row', { name: /Sensitive places/ })).toHaveTextContent('0.11')
    expect(within(panel).getByText(/Life-safety floor applied/)).toBeInTheDocument()
    expect(within(panel).getByText('School')).toBeInTheDocument()
    expect(within(panel).getByText('120 m')).toBeInTheDocument()
  })

  it('says an untriaged incident is scored after classification', async () => {
    await loadWith(
      response({
        incident: detail({ priority_inputs: null, formula_version: null }, { status: 'new', issue_type: null, severity: null, priority_score: null }),
      }),
    )
    const panel = screen.getByRole('region', { name: 'Why this priority' })
    expect(within(panel).getByText(/Scored after classification/)).toBeInTheDocument()
  })

  it('labels the extraction as the system suggestion, with low confidence called out', async () => {
    await loadWith(response())
    const reports = screen.getByRole('region', { name: /Reports/ })
    expect(within(reports).getAllByText('Suggested by the system')).toHaveLength(2)
    expect(within(reports).getByText('91% confident')).toBeInTheDocument()
    const low = within(reports).getByText('42% confident (low)')
    expect(low.className).toMatch(/hazard/)
    expect(within(reports).getByText('Large pothole blocking the right lane.')).toBeInTheDocument()
    expect(within(reports).getByText('Huge pothole in the right lane, cars swerving.').tagName).toBe('BLOCKQUOTE')
  })

  it('opens photos in a lightbox driven by the keyboard', async () => {
    const photos = [
      { id: 'p1', url: 'https://x/1.jpg', content_type: 'image/jpeg' },
      { id: 'p2', url: 'https://x/2.jpg', content_type: 'image/jpeg' },
    ]
    const user = await loadWith(response({ incident: detail({ reports: [report({ photos })] }) }))
    const thumb = screen.getByRole('button', { name: 'Open photo 1 of 2 from report 1' })
    await user.click(thumb)
    const dialog = screen.getByRole('dialog', { name: 'Report 1 photo 1 of 2' })
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://x/1.jpg')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Report 1 photo 2 of 2' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Report 1 photo 1 of 2' })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: 'Report 1 photo 2 of 2' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(thumb).toHaveFocus()
  })

  it('refetches when a photo fails to load (its signed link expired)', async () => {
    const photos = [{ id: 'p1', url: 'https://x/1.jpg', content_type: 'image/jpeg' }]
    await loadWith(response({ incident: detail({ reports: [report({ photos })] }) }))
    const img = screen.getByRole('button', { name: /Open photo 1/ }).querySelector('img')
    img.dispatchEvent(new Event('error'))
    await waitFor(() => expect(api.getIncident).toHaveBeenCalledTimes(2))
  })

  it('renders the audit trail with staff and system actors', async () => {
    const audit = [
      {
        at: '2026-09-26T10:00:00Z',
        action: 'incident.assigned',
        staff_name: 'Dana Okafor',
        detail: { team_id: TEAMS.roads2.id, suggested_team_id: TEAMS.roads1.id, overridden: true, previous_team_id: null },
      },
      {
        at: '2026-09-26T09:30:00Z',
        action: 'incident.triaged',
        staff_name: 'Dana Okafor',
        detail: { issue_type: 'pothole', previous: 'road_damage' },
      },
      {
        at: '2026-09-26T08:00:05Z',
        action: 'report.processed',
        staff_name: null,
        detail: { incident_id: INCIDENT_ID, matched_existing_incident: false, confidence: 0.91, photos_missing: 0 },
      },
    ]
    const assignments = [
      { team: { id: TEAMS.roads2.id, name: 'Roads 2' }, assigned_by: 'Dana Okafor', assigned_at: '2026-09-26T10:00:00Z', ended_at: null, overridden: true },
    ]
    await loadWith(response({ incident: detail({ audit, assignments }) }))
    const activity = screen.getByRole('region', { name: 'Activity' })
    const items = within(activity).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Dana Okafor assigned Roads 2 · overrode the suggestion · still assigned')
    expect(items[0]).toHaveAttribute('data-actor', 'staff')
    expect(items[1]).toHaveTextContent('Dana Okafor set the type to Pothole · was Road damage')
    expect(items[2]).toHaveTextContent('System read a new report · opened this incident · 91% confident')
    expect(items[2]).toHaveAttribute('data-actor', 'system')
  })
})

describe('Incident page: navigation', () => {
  it('links back to the queue', async () => {
    const user = await loadWith(response())
    await user.click(screen.getByRole('link', { name: /Back to queue/ }))
    expect(screen.getByText('Queue page')).toBeInTheDocument()
  })
})
