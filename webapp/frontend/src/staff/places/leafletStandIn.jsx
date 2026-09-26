/**
 * Test-only stand-ins for react-leaflet on the places page: the admin
 * stand-ins (map, marker, clicks) plus vector layers. Each interactive
 * feature is a button ("map feature"), with its style in data attributes.
 * Use with: vi.mock('react-leaflet', () => import('../places/leafletStandIn.jsx'))
 */
import { MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from '../admin/leafletStandIn.jsx'

export { MapContainer, Marker, TileLayer, Tooltip, useMapEvents }

export const fakeMap = {
  setView: () => {},
  fitBounds: () => {},
  invalidateSize: () => {},
  getSize: () => ({ x: 800, y: 600 }),
  getCenter: () => ({ lat: -1.2921, lng: 36.8219 }),
}

export const useMap = () => fakeMap

function vectorLayer(kind) {
  return function Layer({ pathOptions = {}, eventHandlers = {}, interactive, children }) {
    if (interactive === false) {
      return (
        <div data-testid="map-highlight" data-kind={kind}>
          {children}
        </div>
      )
    }
    return (
      <button
        type="button"
        data-testid="map-feature"
        data-kind={kind}
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
