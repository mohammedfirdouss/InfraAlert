import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Shared state for the stand-ins below (vi.mock factories are hoisted).
const mocks = vi.hoisted(() => ({
  searchEnabled: true,
  searchAddress: null,
  reverseGeocode: null,
  mapClick: null,
  setView: null,
}))

// jsdom can't render Leaflet: replace react-leaflet with minimal stand-ins that
// expose a "click the map" and a "drag the pin" affordance.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => (
    <div data-testid="map">
      <button type="button" onClick={() => mocks.mapClick?.({ latlng: { lat: -1.3, lng: 36.8 } })}>
        simulate map click
      </button>
      {children}
    </div>
  ),
  TileLayer: () => null,
  Marker: ({ position, eventHandlers }) => (
    <button
      type="button"
      data-testid="marker"
      data-position={position.join(',')}
      onClick={() =>
        eventHandlers.dragend({ target: { getLatLng: () => ({ lat: -1.31, lng: 36.81 }) } })
      }
    >
      simulate marker drag
    </button>
  ),
  useMap: () => ({ setView: mocks.setView, getCenter: () => ({ lat: -1.29, lng: 36.82 }) }),
  useMapEvents: (handlers) => {
    mocks.mapClick = handlers.click
    return null
  },
}))

vi.mock('../map.js', () => ({
  tileLayer: { url: 'tiles/{z}/{x}/{y}.png', attribution: 'test' },
  markerIcon: {},
  get addressSearchEnabled() {
    return mocks.searchEnabled
  },
  searchAddress: (...args) => mocks.searchAddress(...args),
  reverseGeocode: (...args) => mocks.reverseGeocode(...args),
}))

import LocationPicker from './LocationPicker.jsx'

/** Renders the picker as a controlled component, like ReportForm does. */
function renderPicker() {
  const onChange = vi.fn()
  const onAddressChange = vi.fn()
  function Host() {
    const [value, setValue] = useState(null)
    return (
      <LocationPicker
        value={value}
        onChange={(point) => {
          onChange(point)
          setValue(point)
        }}
        onAddressChange={onAddressChange}
      />
    )
  }
  render(<Host />)
  return { onChange, onAddressChange, user: userEvent.setup() }
}

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')

function mockGeolocation(impl) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(impl) },
  })
  return navigator.geolocation
}

beforeEach(() => {
  mocks.searchEnabled = true
  mocks.searchAddress = vi.fn().mockResolvedValue([])
  mocks.reverseGeocode = vi.fn().mockResolvedValue('Kenyatta Avenue, Nairobi')
  mocks.setView = vi.fn()
  mocks.mapClick = null
  mockGeolocation(() => {})
})

afterEach(() => {
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else delete navigator.geolocation
})

describe('LocationPicker', () => {
  it('shows a hint until a point is chosen, then the coordinates', async () => {
    const { user } = renderPicker()
    expect(screen.getByText(/tap the map to drop a pin/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /simulate map click/i }))

    expect(screen.getByText('-1.30000, 36.80000')).toBeInTheDocument()
    expect(screen.queryByText(/tap the map to drop a pin/i)).not.toBeInTheDocument()
  })

  it('places the pin where the map is tapped and looks up its address', async () => {
    const { user, onChange, onAddressChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /simulate map click/i }))

    expect(onChange).toHaveBeenCalledWith({ lat: -1.3, lng: 36.8 })
    expect(screen.getByTestId('marker')).toHaveAttribute('data-position', '-1.3,36.8')
    await waitFor(() => expect(onAddressChange).toHaveBeenCalledWith('Kenyatta Avenue, Nairobi'))
    expect(mocks.reverseGeocode).toHaveBeenCalledWith({ lat: -1.3, lng: 36.8 }, expect.anything())
  })

  it('reports a null address when reverse geocoding finds nothing', async () => {
    mocks.reverseGeocode.mockResolvedValue(null)
    const { user, onAddressChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /simulate map click/i }))

    await waitFor(() => expect(onAddressChange).toHaveBeenCalledWith(null))
  })

  it('moves the point when the pin is dragged, without recentring the map', async () => {
    const { user, onChange, onAddressChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /simulate map click/i }))

    await user.click(screen.getByTestId('marker'))

    expect(onChange).toHaveBeenLastCalledWith({ lat: -1.31, lng: 36.81 })
    expect(screen.getByText('-1.31000, 36.81000')).toBeInTheDocument()
    expect(mocks.reverseGeocode).toHaveBeenLastCalledWith(
      { lat: -1.31, lng: 36.81 },
      expect.anything(),
    )
    await waitFor(() => expect(onAddressChange).toHaveBeenCalledTimes(2))
    expect(mocks.setView).not.toHaveBeenCalled()
  })

  it('ignores the address of a point the citizen has already moved away from', async () => {
    const first = deferred()
    mocks.reverseGeocode
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('Second place')
    const { user, onAddressChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /simulate map click/i }))
    await user.click(screen.getByTestId('marker'))
    await waitFor(() => expect(onAddressChange).toHaveBeenCalledWith('Second place'))
    first.resolve('First place')
    await first.promise

    expect(onAddressChange).not.toHaveBeenCalledWith('First place')
  })

  it('uses the device location and recentres the map', async () => {
    const geolocation = mockGeolocation((success) =>
      success({ coords: { latitude: -1.28, longitude: 36.83 } }),
    )
    const { user, onChange, onAddressChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true }),
    )
    expect(onChange).toHaveBeenCalledWith({ lat: -1.28, lng: 36.83 })
    expect(mocks.setView).toHaveBeenCalledWith([-1.28, 36.83], 17)
    await waitFor(() => expect(onAddressChange).toHaveBeenCalledWith('Kenyatta Avenue, Nairobi'))
  })

  it('shows a loading state while locating', async () => {
    mockGeolocation(() => {})
    const { user } = renderPicker()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(screen.getByRole('button', { name: /locating/i })).toBeDisabled()
  })

  it('explains when location access is denied', async () => {
    mockGeolocation((_success, failure) => failure({ code: 1 }))
    const { user, onChange } = renderPicker()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(screen.getByText(/location access was denied/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use my location/i })).toBeEnabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('explains when locating times out', async () => {
    mockGeolocation((_success, failure) => failure({ code: 3 }))
    const { user } = renderPicker()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(screen.getByText(/took too long/i)).toBeInTheDocument()
  })

  it('hides the location button when geolocation is unsupported', () => {
    delete navigator.geolocation
    renderPicker()
    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })

  it('searches for an address and moves the pin to the chosen result', async () => {
    mocks.searchAddress.mockResolvedValue([
      { label: 'Moi Avenue, Nairobi', lat: -1.283, lng: 36.826 },
      { label: 'Moi Drive, Nairobi', lat: -1.25, lng: 36.9 },
    ])
    const { user, onChange, onAddressChange } = renderPicker()

    await user.type(screen.getByRole('combobox', { name: /search for an address/i }), 'Moi')
    const option = await screen.findByRole('option', { name: 'Moi Avenue, Nairobi' })
    expect(mocks.searchAddress).toHaveBeenCalledTimes(1)
    expect(mocks.searchAddress).toHaveBeenCalledWith(
      'Moi',
      { lat: -1.29, lng: 36.82 },
      expect.anything(),
    )
    await user.click(option)

    expect(onChange).toHaveBeenCalledWith({ lat: -1.283, lng: 36.826 })
    expect(onAddressChange).toHaveBeenCalledWith('Moi Avenue, Nairobi')
    expect(mocks.setView).toHaveBeenCalledWith([-1.283, 36.826], 17)
    expect(mocks.reverseGeocode).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports choosing a result with the keyboard', async () => {
    mocks.searchAddress.mockResolvedValue([
      { label: 'Moi Avenue, Nairobi', lat: -1.283, lng: 36.826 },
      { label: 'Moi Drive, Nairobi', lat: -1.25, lng: 36.9 },
    ])
    const { user, onAddressChange } = renderPicker()
    const input = screen.getByRole('combobox', { name: /search for an address/i })

    await user.type(input, 'Moi')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Moi Drive, Nairobi' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Enter}')

    expect(onAddressChange).toHaveBeenCalledWith('Moi Drive, Nairobi')
  })

  it('closes the results with Escape', async () => {
    mocks.searchAddress.mockResolvedValue([{ label: 'Moi Avenue', lat: -1.283, lng: 36.826 }])
    const { user } = renderPicker()

    await user.type(screen.getByRole('combobox', { name: /search for an address/i }), 'Moi')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it('ignores results from a stale search', async () => {
    const stale = deferred()
    mocks.searchAddress
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([{ label: 'Moi Avenue, Nairobi', lat: -1.283, lng: 36.826 }])
    const { user } = renderPicker()
    const input = screen.getByRole('combobox', { name: /search for an address/i })

    await user.type(input, 'Moi')
    await waitFor(() => expect(mocks.searchAddress).toHaveBeenCalledTimes(1))
    await user.type(input, ' Av')
    await screen.findByRole('option', { name: 'Moi Avenue, Nairobi' })
    stale.resolve([{ label: 'Moi Drive, Nairobi', lat: -1.25, lng: 36.9 }])
    await stale.promise

    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('option', { name: 'Moi Drive, Nairobi' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Moi Avenue, Nairobi' })).toBeInTheDocument()
  })

  it('renders no search box when address search is disabled', () => {
    mocks.searchEnabled = false
    renderPicker()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
