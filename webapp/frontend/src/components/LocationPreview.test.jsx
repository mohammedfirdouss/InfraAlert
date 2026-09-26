import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const mapProps = vi.hoisted(() => ({ current: null, marker: null }))

vi.mock('react-leaflet', () => ({
  MapContainer: (props) => {
    mapProps.current = props
    return <div data-testid="map">{props.children}</div>
  },
  TileLayer: (props) => <div data-testid="tiles" data-url={props.url} />,
  Marker: (props) => {
    mapProps.marker = props
    return <div data-testid="marker" />
  },
}))

import LocationPreview from './LocationPreview.jsx'
import { markerIcon, tileLayer } from '../map.js'

test('renders a read-only, labelled map with a marker at the location', () => {
  render(<LocationPreview location={{ lat: 6.5244, lng: 3.3792 }} />)
  expect(screen.getByRole('img', { name: /map showing the reported location/i })).toBeInTheDocument()
  const props = mapProps.current
  expect(props.center).toEqual([6.5244, 3.3792])
  expect(props.zoom).toBe(16)
  for (const flag of ['dragging', 'zoomControl', 'scrollWheelZoom', 'touchZoom', 'doubleClickZoom']) {
    expect(props[flag]).toBe(false)
  }
  expect(screen.getByTestId('tiles')).toHaveAttribute('data-url', tileLayer.url)
  expect(mapProps.marker.position).toEqual([6.5244, 3.3792])
  expect(mapProps.marker.icon).toBe(markerIcon)
})
