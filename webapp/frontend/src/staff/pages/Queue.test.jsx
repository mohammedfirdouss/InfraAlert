import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../api.js', () => ({ getQueue: vi.fn() }))

const leaflet = vi.hoisted(() => ({
  map: {
    fitBounds: () => {},
    setView: () => {},
    invalidateSize: () => {},
    getSize: () => ({ x: 800, y: 600 }),
  },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ center, pathOptions, eventHandlers, interactive }) => (
    <button
      type="button"
      data-testid={interactive === false ? 'pin-ring' : 'pin'}
      data-center={center.join(',')}
      data-fill={pathOptions.fillColor}
      onClick={() => eventHandlers?.click?.()}
    />
  ),
  useMap: () => leaflet.map,
}))

import { ApiError } from '../../api/client.js'
import { getQueue } from '../api.js'
import { REFRESH_INTERVAL_MS } from '../queue/useQueueData.js'
import Queue from './Queue.jsx'

const NOW = new Date('2026-09-26T12:00:00Z')

/** @returns {import('../api.js').QueueItem} */
function makeItem(overrides = {}) {
  return {
    id: 'i1',
    status: 'new',
    issue_type: 'pothole',
    priority_score: 0.91,
    severity: 'CRITICAL',
    report_count: 3,
    hazard_flags: [],
    headline: 'Deep pothole across both lanes',
    address_text: 'Moi Avenue',
    location: { lat: -1.28, lng: 36.82 },
    created_at: '2026-09-26T10:00:00Z',
    suggested_team: null,
    assigned_team: null,
    ...overrides,
  }
}

const OPEN = [
  makeItem({
    id: 'i1',
    hazard_flags: ['gas_leak'],
    suggested_team: { id: 't1', name: 'Roads 1' },
  }),
  makeItem({
    id: 'i2',
    severity: 'HIGH',
    priority_score: 0.7,
    issue_type: 'water_leak',
    report_count: 1,
    headline: 'Water main leaking',
    address_text: null,
    location: { lat: -1.3, lng: 36.8 },
    created_at: '2026-09-26T11:48:00Z',
    status: 'assigned',
    assigned_team: { id: 't2', name: 'Water 2' },
  }),
  // Lower score but older: the server ranks it here; we keep that order.
  makeItem({
    id: 'i3',
    severity: 'LOW',
    priority_score: 0.2,
    issue_type: 'broken_streetlight',
    report_count: 2,
    headline: 'Streetlight out',
    address_text: 'Kenyatta Avenue',
    location: { lat: -1.29, lng: 36.83 },
    created_at: '2026-09-23T12:00:00Z',
  }),
]
const TRIAGE = [
  makeItem({
    id: 't1',
    severity: null,
    priority_score: null,
    issue_type: null,
    headline: 'Something smells bad',
    report_count: 1,
  }),
]

/** Resolve getQueue per tab. */
function mockQueue({ triage = TRIAGE, open = OPEN, closed = [] } = {}) {
  getQueue.mockImplementation(async (tab) => ({ triage, open, closed })[tab])
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderQueue(url = '/staff') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/staff"
          element={
            <>
              <Queue />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0))
const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))
const search = () => new URLSearchParams(screen.getByTestId('location').textContent)
const list = () => screen.getByRole('list', { name: /incidents/i })
const rows = () => within(list()).getAllByRole('link')

let visibility = 'visible'
function setVisibility(value) {
  visibility = value
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  getQueue.mockReset()
  mockQueue()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  leaflet.map.fitBounds = vi.fn()
  leaflet.map.setView = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the list', () => {
  test('renders rows in server order with urgency badges', async () => {
    renderQueue()
    expect(screen.getByRole('heading', { level: 1, name: 'Queue' })).toBeInTheDocument()
    await flush()

    const [first, second, third] = rows()
    expect(rows()).toHaveLength(3)
    expect(first).toHaveAttribute('href', '/staff/incidents/i1')
    expect(second).toHaveAttribute('href', '/staff/incidents/i2')
    expect(third).toHaveAttribute('href', '/staff/incidents/i3')

    const r1 = within(first)
    expect(r1.getByText('CRITICAL')).toBeInTheDocument()
    expect(r1.getByText('0.91')).toBeInTheDocument()
    expect(r1.getByText('Gas leak')).toBeInTheDocument()
    expect(r1.getByText('Pothole')).toBeInTheDocument()
    expect(r1.getByText('Deep pothole across both lanes')).toBeInTheDocument()
    expect(r1.getByText('×3 reports')).toBeInTheDocument()
    expect(r1.getByText('New')).toBeInTheDocument()
    expect(r1.getByText('Suggested: Roads 1')).toHaveClass('border-dashed')
    const age = r1.getByText('2h')
    expect(age.tagName).toBe('TIME')
    expect(age).toHaveAttribute('title')
    // Life-safety hazard: orange left edge.
    expect(first).toHaveClass('border-l-hazard-500')

    const r2 = within(second)
    expect(r2.getByText('HIGH')).toBeInTheDocument()
    expect(r2.getByText('Water main leaking')).toBeInTheDocument()
    expect(r2.getByText('-1.30000, 36.80000')).toBeInTheDocument()
    expect(r2.getByText('×1 report')).toBeInTheDocument()
    expect(r2.getByText('12m')).toBeInTheDocument()
    expect(r2.getByText('Assigned')).toBeInTheDocument()
    expect(r2.getByText('Water 2')).not.toHaveClass('border-dashed')
    expect(second).not.toHaveClass('border-l-hazard-500')

    expect(within(third).getByText('3d')).toBeInTheDocument()
  })

  test('each row has a descriptive accessible name', async () => {
    renderQueue()
    await flush()
    expect(
      screen.getByRole('link', {
        name: 'Critical, pothole, hazard: gas leak, 3 reports, 2 hours ago, Moi Avenue, New, suggested team Roads 1',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'High, water leak, 1 report, 12 minutes ago, -1.30000, 36.80000, Assigned, assigned to Water 2',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Open incidents, highest priority first' })).toBeInTheDocument()
  })

  test('shows live counts and the last update time', async () => {
    renderQueue()
    await flush()
    expect(screen.getByTestId('count-open')).toHaveTextContent('3')
    expect(screen.getByTestId('count-closed')).toHaveTextContent('0')
    expect(screen.getByText(/Last updated/)).toHaveTextContent(/Last updated \d\d:\d\d/)
  })
})

describe('tabs and filter', () => {
  test('loads every tab, and syncs tab and filter with the URL', async () => {
    renderQueue()
    await flush()
    expect(getQueue).toHaveBeenCalledWith('triage', null)
    expect(getQueue).toHaveBeenCalledWith('open', null)
    expect(getQueue).toHaveBeenCalledWith('closed', null)
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true')

    getQueue.mockClear()
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: 'water_leak' } })
    await flush()
    expect(search().get('type')).toBe('water_leak')
    expect(getQueue).toHaveBeenCalledWith('open', 'water_leak')
    expect(getQueue).toHaveBeenCalledWith('closed', 'water_leak')
    // Triage items are unclassified, so the filter never applies there.
    expect(getQueue).toHaveBeenCalledWith('triage', null)

    getQueue.mockClear()
    fireEvent.click(screen.getByRole('tab', { name: /Recently closed/ }))
    await flush()
    expect(search().get('tab')).toBe('closed')
    expect(screen.getByRole('tab', { name: /Recently closed/ })).toHaveAttribute('aria-selected', 'true')
    expect(getQueue).toHaveBeenCalledWith('closed', 'water_leak')

    fireEvent.click(screen.getByRole('tab', { name: /Needs triage/ }))
    await flush()
    expect(search().get('tab')).toBe('triage')
    expect(screen.queryByLabelText('Issue type')).not.toBeInTheDocument()
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getByText('Unclassified')).toBeInTheDocument()
  })

  test('restores tab and filter from the URL', async () => {
    renderQueue('/staff?tab=closed&type=sewage')
    await flush()
    expect(screen.getByRole('tab', { name: /Recently closed/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Issue type')).toHaveValue('sewage')
    expect(getQueue).toHaveBeenCalledWith('closed', 'sewage')
  })

  test('arrow keys move between tabs', async () => {
    renderQueue()
    await flush()
    fireEvent.keyDown(screen.getByRole('tab', { name: /Open/ }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: /Needs triage/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Needs triage/ })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'queue-tab-triage')
  })

  test('the triage count is hazard orange only when reports are waiting', async () => {
    const { unmount } = renderQueue()
    await flush()
    expect(screen.getByTestId('count-triage')).toHaveTextContent('1')
    expect(screen.getByTestId('count-triage')).toHaveClass('bg-hazard-500')
    unmount()

    mockQueue({ triage: [] })
    renderQueue()
    await flush()
    expect(screen.getByTestId('count-triage')).toHaveTextContent('0')
    expect(screen.getByTestId('count-triage')).not.toHaveClass('bg-hazard-500')
  })
})

describe('states', () => {
  test('shows a skeleton while loading', async () => {
    getQueue.mockImplementation(() => new Promise(() => {}))
    renderQueue()
    expect(screen.getByText('Loading the queue…').closest('[role="status"]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.queryByRole('list', { name: /incidents/i })).not.toBeInTheDocument()
  })

  test('an empty state per tab', async () => {
    mockQueue({ triage: [], open: [], closed: [] })
    renderQueue()
    await flush()
    expect(screen.getByRole('heading', { name: 'Queue clear' })).toBeInTheDocument()
    expect(screen.getByText('ALL CLEAR')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Needs triage/ }))
    await flush()
    expect(screen.getByRole('heading', { name: 'No reports waiting for triage' })).toBeInTheDocument()
    expect(screen.getByText('ALL CLEAR')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Recently closed/ }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Nothing closed recently' })).toBeInTheDocument()
  })

  test('a filtered empty state offers to clear the filter', async () => {
    mockQueue({ open: [] })
    renderQueue('/staff?type=sewage')
    await flush()
    expect(screen.getByRole('heading', { name: 'No open sewage incidents' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all issue types' }))
    await flush()
    expect(search().get('type')).toBeNull()
  })

  test('an error, then retry', async () => {
    getQueue.mockRejectedValue(new ApiError(500, null))
    renderQueue()
    await flush()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load the queue')
    expect(alert).toHaveTextContent('HTTP 500')

    mockQueue()
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(rows()).toHaveLength(3)
  })

  test('a 403 says so', async () => {
    getQueue.mockRejectedValue(new ApiError(403, 'forbidden'))
    renderQueue()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('You don’t have access to the dispatch queue.')
  })
})

describe('refresh', () => {
  test('auto-refreshes every 20 s while visible, and pauses while hidden', async () => {
    renderQueue()
    await flush()
    expect(getQueue).toHaveBeenCalledTimes(3)

    await advance(REFRESH_INTERVAL_MS)
    expect(getQueue).toHaveBeenCalledTimes(6)

    setVisibility('hidden')
    await advance(REFRESH_INTERVAL_MS * 3)
    expect(getQueue).toHaveBeenCalledTimes(6)

    // Coming back catches up at once, then resumes the interval.
    await act(async () => setVisibility('visible'))
    await flush()
    expect(getQueue).toHaveBeenCalledTimes(9)
    await advance(REFRESH_INTERVAL_MS)
    expect(getQueue).toHaveBeenCalledTimes(12)
  })

  test('a refresh keeps the list and map on screen and does not refit the map', async () => {
    renderQueue()
    await flush()
    const map = screen.getByTestId('map')
    const firstRow = rows()[0]
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(1)

    let resolveOpen
    getQueue.mockImplementation((tab) =>
      tab === 'open'
        ? new Promise((resolve) => (resolveOpen = resolve))
        : Promise.resolve({ triage: TRIAGE, closed: [] }[tab]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the queue' }))
    await flush()
    expect(screen.queryByText('Loading the queue…')).not.toBeInTheDocument()
    expect(rows()).toHaveLength(3)

    await act(async () => resolveOpen([...OPEN.map((i) => ({ ...i })), makeItem({ id: 'i4', headline: 'New one' })]))
    await flush()
    expect(rows()).toHaveLength(4)
    expect(rows()[0]).toBe(firstRow) // same DOM node: not re-mounted
    expect(screen.getByTestId('map')).toBe(map)
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(1)
  })

  test('a failed refresh keeps the old list and says so', async () => {
    renderQueue()
    await flush()
    getQueue.mockRejectedValue(new ApiError(502, null))
    await advance(REFRESH_INTERVAL_MS)
    expect(rows()).toHaveLength(3)
    expect(screen.getByText(/Couldn’t refresh/)).toBeInTheDocument()
  })

  test('changing the filter refits the map', async () => {
    renderQueue()
    await flush()
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: 'pothole' } })
    await flush()
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(2)
  })
})

describe('map and selection', () => {
  test('pins are severity coloured; hovering a row highlights its pin', async () => {
    renderQueue()
    await flush()
    const pins = screen.getAllByTestId('pin')
    expect(pins.map((p) => p.dataset.fill)).toEqual(['#ff5a1f', '#ffd60a', '#e7e2d6'])
    expect(screen.queryByTestId('pin-ring')).not.toBeInTheDocument()

    fireEvent.mouseEnter(rows()[1])
    expect(screen.getByTestId('pin-ring')).toHaveAttribute('data-center', '-1.3,36.8')
    fireEvent.mouseLeave(rows()[1])
    expect(screen.queryByTestId('pin-ring')).not.toBeInTheDocument()

    fireEvent.focus(rows()[2])
    expect(screen.getByTestId('pin-ring')).toHaveAttribute('data-center', '-1.29,36.83')
  })

  test('clicking a pin selects and scrolls to its row', async () => {
    renderQueue()
    await flush()
    fireEvent.click(screen.getAllByTestId('pin')[2])
    expect(rows()[2]).toHaveAttribute('data-selected', 'true')
    expect(rows()[0]).not.toHaveAttribute('data-selected')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.getByTestId('pin-ring')).toHaveAttribute('data-center', '-1.29,36.83')

    // Selection survives a refresh.
    await advance(REFRESH_INTERVAL_MS)
    expect(rows()[2]).toHaveAttribute('data-selected', 'true')
  })

  test('the map is labelled as a visual aid', async () => {
    renderQueue()
    await flush()
    expect(screen.getByRole('region', { name: /visual aid/ })).toContainElement(screen.getByTestId('map'))
  })

  test('on mobile, a list/map toggle', async () => {
    renderQueue()
    await flush()
    const listPane = screen.getByTestId('queue-list-pane')
    const mapPane = screen.getByTestId('queue-map-pane')
    const listButton = screen.getByRole('button', { name: 'List' })
    const mapButton = screen.getByRole('button', { name: 'Map' })
    expect(listButton).toHaveAttribute('aria-pressed', 'true')
    expect(listPane).not.toHaveClass('hidden')
    expect(mapPane).toHaveClass('hidden')

    fireEvent.click(mapButton)
    expect(mapButton).toHaveAttribute('aria-pressed', 'true')
    expect(listPane).toHaveClass('hidden')
    expect(mapPane).not.toHaveClass('hidden')

    // Picking a pin goes back to the list, at that row.
    fireEvent.click(screen.getAllByTestId('pin')[1])
    expect(listButton).toHaveAttribute('aria-pressed', 'true')
    expect(listPane).not.toHaveClass('hidden')
    expect(rows()[1]).toHaveAttribute('data-selected', 'true')
  })
})
