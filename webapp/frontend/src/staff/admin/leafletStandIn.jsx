/**
 * Test-only stand-ins for react-leaflet (jsdom can't render Leaflet).
 * Use with: vi.mock('react-leaflet', () => import('../admin/leafletStandIn.jsx'))
 *
 * Each map renders a "simulate map click" button (clicks at CLICK_POINT); each
 * draggable marker a "simulate marker drag" button (drops at DRAG_POINT).
 */
import { createContext, useContext, useRef } from 'react'

export const CLICK_POINT = { lat: -1.25, lng: 36.75 }
export const DRAG_POINT = { lat: -1.26, lng: 36.76 }
export const MAP_CENTRE = { lat: -1.2921, lng: 36.8219 }

const MapContext = createContext(null)

const fakeMap = {
  setView: () => {},
  fitBounds: () => {},
  getCenter: () => MAP_CENTRE,
}

export function MapContainer({ children }) {
  const handlers = useRef({})
  return (
    <MapContext.Provider value={handlers}>
      <div data-testid="map">
        <button type="button" onClick={() => handlers.current.click?.({ latlng: CLICK_POINT })}>
          simulate map click
        </button>
        {children}
      </div>
    </MapContext.Provider>
  )
}

export const TileLayer = () => null
export const Tooltip = ({ children }) => <span>{children}</span>

export function Marker({ title, opacity = 1, draggable, eventHandlers = {}, children }) {
  return (
    <div data-testid="marker" data-title={title ?? ''} data-opacity={String(opacity)}>
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
