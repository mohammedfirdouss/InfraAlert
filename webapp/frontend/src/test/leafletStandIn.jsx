/**
 * Test-only stand-ins for react-leaflet (jsdom can't render Leaflet). The one
 * copy for every test that renders a map:
 *
 *   vi.mock('react-leaflet', () => import('../test/leafletStandIn.jsx'))
 *
 * - Each map has a "simulate map click" button (clicks at CLICK_POINT).
 * - Each marker is a "marker <title>" button; a draggable one also has a
 *   "simulate marker drag" button (drops at DRAG_POINT).
 * - Vector layers (circles, lines, polygons) are "map feature" buttons, with
 *   their style in data attributes; non-interactive ones are "map-highlight".
 * - useMap() and useMapEvents() return the same `fakeMap`, whose setView and
 *   fitBounds are spies (clear them in beforeEach when a test counts calls).
 * - `lastProps` holds the props of the most recently rendered map and marker.
 */
import { createContext, useContext, useRef } from 'react'
import { vi } from 'vitest'

export const CLICK_POINT = { lat: -1.25, lng: 36.75 }
export const DRAG_POINT = { lat: -1.26, lng: 36.76 }
export const MAP_CENTRE = { lat: -1.2921, lng: 36.8219 }

export const fakeMap = {
  setView: vi.fn(),
  fitBounds: vi.fn(),
  invalidateSize: () => {},
  getSize: () => ({ x: 800, y: 600 }),
  getCenter: () => MAP_CENTRE,
}

/** @type {{ map: Record<string, any> | null, marker: Record<string, any> | null }} */
export const lastProps = { map: null, marker: null }

const MapContext = createContext(null)

export function MapContainer(props) {
  lastProps.map = props
  const handlers = useRef({})
  return (
    <MapContext.Provider value={handlers}>
      <div data-testid="map">
        <button type="button" onClick={() => handlers.current.click?.({ latlng: CLICK_POINT })}>
          simulate map click
        </button>
        {props.children}
      </div>
    </MapContext.Provider>
  )
}

export const TileLayer = ({ url }) => <span data-testid="tiles" data-url={url} hidden />
export const Tooltip = ({ children }) => <span>{children}</span>

export function Marker(props) {
  lastProps.marker = props
  const { position, title, opacity = 1, draggable, eventHandlers = {}, children } = props
  return (
    <div
      data-testid="marker"
      data-title={title ?? ''}
      data-opacity={String(opacity)}
      data-position={Array.isArray(position) ? position.join(',') : undefined}
    >
      <button
        type="button"
        onMouseEnter={() => eventHandlers.mouseover?.()}
        onMouseLeave={() => eventHandlers.mouseout?.()}
        onClick={() => eventHandlers.click?.()}
      >
        marker {title ?? ''}
      </button>
      {draggable && (
        <button
          type="button"
          onClick={() => eventHandlers.dragend?.({ target: { getLatLng: () => DRAG_POINT } })}
        >
          simulate marker drag
        </button>
      )}
      {children}
    </div>
  )
}

export const useMap = () => fakeMap

export function useMapEvents(handlers) {
  const ctx = useContext(MapContext)
  if (ctx) ctx.current = handlers
  return fakeMap
}

function vectorLayer(kind) {
  return function Layer({ center, pathOptions = {}, eventHandlers = {}, interactive, children }) {
    const centre = Array.isArray(center) ? center.join(',') : undefined
    if (interactive === false) {
      return (
        <div data-testid="map-highlight" data-kind={kind} data-center={centre}>
          {children}
        </div>
      )
    }
    return (
      <button
        type="button"
        data-testid="map-feature"
        data-kind={kind}
        data-center={centre}
        data-colour={pathOptions.fillColor}
        data-dashed={pathOptions.dashArray ? 'true' : 'false'}
        onMouseEnter={() => eventHandlers.mouseover?.()}
        onMouseLeave={() => eventHandlers.mouseout?.()}
        onClick={() => eventHandlers.click?.()}
      >
        map feature
        {children}
      </button>
    )
  }
}

export const CircleMarker = vectorLayer('circle')
export const Polyline = vectorLayer('line')
export const Polygon = vectorLayer('polygon')
