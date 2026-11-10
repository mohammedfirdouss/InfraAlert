import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

vi.mock('react-leaflet', () => import('../test/leafletStandIn.jsx'))

import { lastProps } from '../test/leafletStandIn.jsx'
import LocationPreview from './LocationPreview.jsx'
import { markerIcon, tileLayer } from '../map.js'

test('renders a read-only, labelled map with a marker at the location', () => {
  render(<LocationPreview location={{ lat: 6.5244, lng: 3.3792 }} />)
  expect(screen.getByRole('img', { name: /map showing the reported location/i })).toBeInTheDocument()
  const props = lastProps.map
  expect(props.center).toEqual([6.5244, 3.3792])
  expect(props.zoom).toBe(16)
  for (const flag of ['dragging', 'zoomControl', 'scrollWheelZoom', 'touchZoom', 'doubleClickZoom']) {
    expect(props[flag]).toBe(false)
  }
  expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', tileLayer.url)
  expect(lastProps.marker.position).toEqual([6.5244, 3.3792])
  expect(lastProps.marker.icon).toBe(markerIcon)
})
