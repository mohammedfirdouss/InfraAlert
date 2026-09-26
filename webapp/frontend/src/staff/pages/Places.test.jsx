import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '../../api/client.js'

vi.mock('react-leaflet', () => import('../places/leafletStandIn.jsx'))
vi.mock('../../map.js', () => ({
  tileLayer: { url: 'tiles/{z}/{x}/{y}.png', attribution: 'test' },
  markerIcon: {},
}))
vi.mock('../api.js', () => ({
  getPlaces: vi.fn(),
  createPlace: vi.fn(),
  updatePlace: vi.fn(),
}))
vi.mock('../auth.jsx', () => ({ useStaff: vi.fn() }))

import { createPlace, getPlaces, updatePlace } from '../api.js'
import { useStaff } from '../auth.jsx'
import { CLICK_POINT } from '../admin/leafletStandIn.jsx'
import Places, { PAGE_SIZE } from './Places.jsx'

const CATEGORIES = [
  { id: 'hospital', weight: 1.0 },
  { id: 'school', weight: 0.9 },
  { id: 'clinic', weight: 0.85 },
  { id: 'major_road', weight: 0.7 },
  { id: 'market', weight: 0.6 },
]

const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] })

const PLACES = [
  {
    id: 'p1',
    name: 'Kenyatta National Hospital',
    category: 'hospital',
    geometry: point(36.807, -1.3009),
    source: 'osm',
    osm_id: 'node/123',
    enabled: true,
  },
  {
    id: 'p2',
    name: 'Uhuru Highway',
    category: 'major_road',
    geometry: { type: 'LineString', coordinates: [[36.81, -1.29], [36.82, -1.3]] },
    source: 'osm',
    osm_id: 'way/456',
    enabled: true,
  },
  {
    id: 'p3',
    name: 'City Market',
    category: 'market',
    geometry: { type: 'Polygon', coordinates: [[[36.82, -1.28], [36.83, -1.28], [36.83, -1.29], [36.82, -1.28]]] },
    source: 'osm',
    osm_id: 'way/789',
    enabled: false,
  },
  {
    id: 'p4',
    name: 'Community Clinic',
    category: 'clinic',
    geometry: point(36.8, -1.27),
    source: 'manual',
    osm_id: null,
    enabled: true,
  },
  {
    id: 'p5',
    name: null,
    category: 'school',
    geometry: point(36.79, -1.31),
    source: 'osm',
    osm_id: 'node/999',
    enabled: true,
  },
]

function response(overrides = {}) {
  return structuredClone({
    places: PLACES,
    categories: CATEGORIES,
    last_import_at: '2026-09-01T03:00:00Z',
    ...overrides,
  })
}

function signInAs(role) {
  useStaff.mockReturnValue({
    status: 'signed_in',
    staff: { id: 'me', email: 'me@city.gov', display_name: 'Me', role },
  })
}

function renderPage() {
  render(
    <MemoryRouter>
      <Places />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const list = () => within(screen.getByRole('region', { name: 'Place list' }))
const rowNames = () =>
  list()
    .queryAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'))
const row = (name) => screen.getByRole('listitem', { name })
const loaded = () => screen.findByRole('listitem', { name: 'Kenyatta National Hospital' })

beforeEach(() => {
  vi.mocked(getPlaces).mockReset().mockResolvedValue(response())
  vi.mocked(createPlace).mockReset()
  vi.mocked(updatePlace).mockReset()
  signInAs('admin')
})

describe('Places list', () => {
  it('lists places A–Z with category and source tags, and the last import', async () => {
    renderPage()
    await loaded()

    expect(screen.getByRole('heading', { name: 'Sensitive places' })).toBeInTheDocument()
    expect(screen.getByText(/within 300 m of a sensitive place/)).toBeInTheDocument()
    expect(screen.getByText(/Last OpenStreetMap import:/)).toHaveTextContent(/2026/)

    expect(rowNames()).toEqual(['City Market', 'Community Clinic', 'Kenyatta National Hospital', 'Uhuru Highway', 'Unnamed'])

    const hospital = within(row('Kenyatta National Hospital'))
    expect(hospital.getByText('Hospital')).toBeInTheDocument()
    expect(hospital.getByText('OSM')).toBeInTheDocument()
    expect(hospital.getByText('node/123')).toHaveClass('font-mono')
    expect(hospital.getByRole('switch', { name: 'Kenyatta National Hospital enabled' })).toBeChecked()

    const clinic = within(row('Community Clinic'))
    expect(clinic.getByText('Manual')).toBeInTheDocument()
    expect(clinic.getByRole('button', { name: 'Edit Community Clinic' })).toBeInTheDocument()

    expect(within(row('City Market')).getByRole('switch')).not.toBeChecked()
    expect(screen.getByText('5 places')).toBeInTheDocument()
  })

  it('draws points, roads and areas on the map, with disabled places dashed', async () => {
    renderPage()
    await loaded()
    const features = screen.getAllByTestId('map-feature')
    expect(features.map((f) => f.dataset.kind)).toEqual(['polygon', 'circle', 'circle', 'line', 'circle'])
    expect(features.map((f) => f.dataset.dashed)).toEqual(['true', 'false', 'false', 'false', 'false'])
  })

  it('says when there has never been an import and how to run one', async () => {
    getPlaces.mockResolvedValue(response({ last_import_at: null, places: [] }))
    renderPage()
    expect(await screen.findByText('never')).toBeInTheDocument()
    expect(screen.getByText('python -m infraalert.cli import-osm')).toBeInTheDocument()
    expect(screen.getByText('No sensitive places yet')).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    getPlaces.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading places…')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    getPlaces.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const user = renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the places.")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await loaded()).toBeInTheDocument()
    expect(getPlaces).toHaveBeenCalledTimes(2)
  })
})

describe('filters', () => {
  it('filters by category (showing weights), source, status and name', async () => {
    const user = renderPage()
    await loaded()

    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(within(category).getByRole('option', { name: 'Hospital ×1.0' })).toBeInTheDocument()
    expect(within(category).getByRole('option', { name: 'Clinic ×0.85' })).toBeInTheDocument()
    await user.selectOptions(category, 'major_road')
    expect(rowNames()).toEqual(['Uhuru Highway'])
    expect(screen.getAllByTestId('map-feature')).toHaveLength(1)
    await user.selectOptions(category, '')

    const source = within(screen.getByRole('group', { name: 'Source' }))
    await user.click(source.getByRole('button', { name: 'Added by staff' }))
    expect(rowNames()).toEqual(['Community Clinic'])
    await user.click(source.getByRole('button', { name: 'OpenStreetMap' }))
    expect(rowNames()).toHaveLength(4)
    await user.click(source.getByRole('button', { name: 'All' }))

    const status = within(screen.getByRole('group', { name: 'Status' }))
    await user.click(status.getByRole('button', { name: 'Disabled' }))
    expect(rowNames()).toEqual(['City Market'])
    expect(status.getByRole('button', { name: 'Disabled' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(status.getByRole('button', { name: 'Enabled' }))
    expect(rowNames()).not.toContain('City Market')
    await user.click(status.getByRole('button', { name: 'All' }))

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kenya')
    expect(rowNames()).toEqual(['Kenyatta National Hospital'])
    expect(screen.getByText('1 of 5 places match')).toBeInTheDocument()
  })

  it('finds places by OSM id, and says when nothing matches', async () => {
    const user = renderPage()
    await loaded()
    const search = screen.getByRole('searchbox', { name: 'Search' })
    await user.type(search, 'way/456')
    expect(rowNames()).toEqual(['Uhuru Highway'])

    await user.clear(search)
    await user.type(search, 'nowhere')
    expect(screen.getByText('No places match these filters')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }))
    expect(rowNames()).toHaveLength(5)
    expect(search).toHaveValue('')
  })

  it('renders a page of rows at a time, with "Show more"', async () => {
    const many = Array.from({ length: PAGE_SIZE + 50 }, (_, i) => ({
      id: `m${i}`,
      name: `Road ${String(i).padStart(3, '0')}`,
      category: 'major_road',
      geometry: point(36.8, -1.29),
      source: 'osm',
      osm_id: `way/${i}`,
      enabled: true,
    }))
    getPlaces.mockResolvedValue(response({ places: many }))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Road 000' })

    expect(rowNames()).toHaveLength(PAGE_SIZE)
    expect(screen.getByText(`Showing ${PAGE_SIZE} of ${PAGE_SIZE + 50}`)).toBeInTheDocument()
    // The map still draws every matching place.
    expect(screen.getAllByTestId('map-feature')).toHaveLength(PAGE_SIZE + 50)

    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(rowNames()).toHaveLength(PAGE_SIZE + 50)
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('pages in and focuses the row of a clicked map feature beyond the first page', async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
      id: `m${i}`,
      name: `Road ${String(i).padStart(3, '0')}`,
      category: 'major_road',
      geometry: point(36.8, -1.29),
      source: 'osm',
      osm_id: `way/${i}`,
      enabled: true,
    }))
    getPlaces.mockResolvedValue(response({ places: many }))
    const user = renderPage()
    await screen.findByRole('listitem', { name: 'Road 000' })

    await user.click(screen.getAllByTestId('map-feature')[PAGE_SIZE + 2])
    const target = row(`Road ${PAGE_SIZE + 2}`)
    expect(target).toHaveFocus()
    expect(target).toHaveClass('bg-signal-100')
  })
})

describe('map and list link', () => {
  it('highlights the hovered row on the map, and a clicked feature selects its row', async () => {
    const user = renderPage()
    await loaded()

    await user.hover(row('Uhuru Highway'))
    expect(row('Uhuru Highway')).toHaveClass('bg-signal-100')
    const highlight = screen.getAllByTestId('map-highlight')
    expect(highlight.at(-1)).toHaveTextContent('Uhuru Highway')
    await user.unhover(row('Uhuru Highway'))

    // Features follow the list order: the second is Community Clinic.
    await user.click(screen.getAllByTestId('map-feature')[1])
    expect(row('Community Clinic')).toHaveFocus()
    expect(row('Community Clinic')).toHaveClass('bg-signal-100')
  })

  it('switches between list and map on small screens', async () => {
    const user = renderPage()
    await loaded()
    const toggle = within(screen.getByRole('group', { name: 'Show' }))
    expect(screen.getByTestId('places-map-pane')).toHaveClass('hidden')
    await user.click(toggle.getByRole('button', { name: 'Map' }))
    expect(screen.getByTestId('places-list-pane')).toHaveClass('hidden')
    expect(screen.getByTestId('places-map-pane')).not.toHaveClass('hidden')

    // Clicking a feature brings the list back with its row.
    await user.click(screen.getAllByTestId('map-feature')[2])
    expect(screen.getByTestId('places-list-pane')).not.toHaveClass('hidden')
    expect(row('Kenyatta National Hospital')).toHaveFocus()
  })
})

describe('enabling and disabling', () => {
  it('asks before disabling, explains the effect, then saves', async () => {
    updatePlace.mockImplementation(async (id, changes) => ({ ...PLACES[0], ...changes }))
    const user = renderPage()
    await loaded()

    await user.click(screen.getByRole('switch', { name: 'Kenyatta National Hospital enabled' }))
    const confirm = within(screen.getByRole('group', { name: 'Disable Kenyatta National Hospital?' }))
    expect(confirm.getByText(/no longer get its priority bonus/)).toBeInTheDocument()
    expect(confirm.getByText(/stays disabled after future OpenStreetMap imports/)).toBeInTheDocument()
    expect(updatePlace).not.toHaveBeenCalled()

    await user.click(confirm.getByRole('button', { name: 'Disable place' }))
    expect(updatePlace).toHaveBeenCalledWith('p1', { enabled: false })
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Kenyatta National Hospital enabled' })).not.toBeChecked(),
    )
    expect(screen.queryByRole('group', { name: /Disable Kenyatta/ })).not.toBeInTheDocument()
    expect(screen.getByText(/“Kenyatta National Hospital” disabled/)).toBeInTheDocument()
  })

  it('can back out of disabling', async () => {
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('switch', { name: 'Uhuru Highway enabled' }))
    await user.click(screen.getByRole('button', { name: 'Keep enabled' }))
    expect(screen.getByRole('switch', { name: 'Uhuru Highway enabled' })).toBeChecked()
    expect(updatePlace).not.toHaveBeenCalled()
  })

  it('does not mention imports for a manual place', async () => {
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('switch', { name: 'Community Clinic enabled' }))
    const confirm = screen.getByRole('group', { name: 'Disable Community Clinic?' })
    expect(confirm).not.toHaveTextContent(/OpenStreetMap/)
  })

  it('enables straight away', async () => {
    updatePlace.mockImplementation(async (id, changes) => ({ ...PLACES[2], ...changes }))
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('switch', { name: 'City Market enabled' }))
    expect(updatePlace).toHaveBeenCalledWith('p3', { enabled: true })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'City Market enabled' })).toBeChecked())
  })

  it('shows a failed save in the row', async () => {
    updatePlace.mockRejectedValue(new ApiError(500, 'boom'))
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('switch', { name: 'City Market enabled' }))
    expect(await within(row('City Market')).findByText(/Something went wrong/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'City Market enabled' })).not.toBeChecked()
  })
})

describe('the place panel', () => {
  it('shows OSM places read-only, with a note', async () => {
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Details for Uhuru Highway' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Uhuru Highway' }))
    expect(dialog.getByText(/comes from OpenStreetMap/)).toBeInTheDocument()
    expect(dialog.getByText('Road line')).toBeInTheDocument()
    expect(dialog.getByText('way/456')).toBeInTheDocument()
    expect(dialog.queryByRole('textbox')).not.toBeInTheDocument()
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()

    await user.click(dialog.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds a place and puts it in the list', async () => {
    createPlace.mockImplementation(async ({ name, category, location }) => ({
      id: 'new1',
      name,
      category,
      geometry: point(location.lng, location.lat),
      source: 'manual',
      osm_id: null,
      enabled: true,
    }))
    const user = renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Add place' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a place' }))

    // Everything is required.
    await user.click(dialog.getByRole('button', { name: 'Add place' }))
    expect(dialog.getByText(/Give the place a name/)).toBeInTheDocument()
    expect(dialog.getByText(/Choose a category;/)).toBeInTheDocument()
    expect(dialog.getByText(/Set where the place is/)).toBeInTheDocument()
    expect(createPlace).not.toHaveBeenCalled()

    await user.type(dialog.getByRole('textbox', { name: 'Name' }), '  St. Mary School ')
    const category = dialog.getByRole('combobox', { name: 'Category' })
    expect(within(category).getByRole('option', { name: 'School ×0.9' })).toBeInTheDocument()
    await user.selectOptions(category, 'school')
    await user.click(dialog.getByRole('button', { name: 'simulate map click' }))
    await user.click(dialog.getByRole('button', { name: 'Add place' }))

    expect(createPlace).toHaveBeenCalledWith({
      name: 'St. Mary School',
      category: 'school',
      location: { lat: CLICK_POINT.lat, lng: CLICK_POINT.lng },
    })
    expect(await screen.findByRole('listitem', { name: 'St. Mary School' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('“St. Mary School” added.')).toBeInTheDocument()
  })

  it('keeps the panel open with a message when adding fails', async () => {
    createPlace.mockRejectedValue(new ApiError(422, 'invalid'))
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Add place' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'X')
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Category' }), 'market')
    await user.click(dialog.getByRole('button', { name: 'simulate map click' }))
    await user.click(dialog.getByRole('button', { name: 'Add place' }))
    expect(await dialog.findByText(/Some of the details were not accepted/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('edits a manual place, sending only what changed', async () => {
    updatePlace.mockImplementation(async (id, changes) => ({
      ...PLACES[3],
      name: changes.name ?? PLACES[3].name,
      geometry: changes.location ? point(changes.location.lng, changes.location.lat) : PLACES[3].geometry,
    }))
    const user = renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: 'Edit Community Clinic' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Edit Community Clinic' }))
    const name = dialog.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('Community Clinic')
    expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveValue('clinic')
    expect(dialog.getByText('-1.27000')).toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Eastlands Clinic')
    await user.click(dialog.getByRole('button', { name: 'simulate marker drag' }))
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))

    expect(updatePlace).toHaveBeenCalledWith('p4', {
      name: 'Eastlands Clinic',
      location: { lat: -1.26, lng: 36.76 },
    })
    expect(await screen.findByRole('listitem', { name: 'Eastlands Clinic' })).toBeInTheDocument()
    expect(screen.getByText('Changes to “Eastlands Clinic” saved.')).toBeInTheDocument()
  })

  it('closes without saving when nothing changed', async () => {
    const user = renderPage()
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Edit Community Clinic' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updatePlace).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is admin-only', async () => {
    signInAs('supervisor')
    renderPage()
    await loaded()
    expect(screen.queryByRole('button', { name: 'Add place' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Community Clinic' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Community Clinic enabled' })).toBeDisabled()
  })
})
