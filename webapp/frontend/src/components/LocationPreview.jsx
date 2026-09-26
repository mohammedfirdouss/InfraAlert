import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import { markerIcon, tileLayer } from '../map.js'

/** "6.52441° N" style surveyor reading for one axis. */
function bearing(value, positive, negative) {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`
}

/**
 * LocationPreview: a small read-only map showing where a report is, with a
 * surveyor readout of the coordinates overlaid.
 *
 * @param {{ location: { lat: number, lng: number } }} props
 */
export default function LocationPreview({ location }) {
  const center = [location.lat, location.lng]
  return (
    <div
      role="img"
      aria-label={`Map showing the reported location at ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
      className="relative h-56 w-full overflow-hidden rounded-xl border-2 border-ink bg-concrete-200"
    >
      <MapContainer
        // Re-mount when the point changes: MapContainer's center is only read once.
        key={`${location.lat},${location.lng}`}
        center={center}
        zoom={16}
        dragging={false}
        zoomControl={false}
        scrollWheelZoom={false}
        touchZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        className="h-full w-full"
      >
        <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
        <Marker position={center} icon={markerIcon} interactive={false} keyboard={false} />
      </MapContainer>
      <span
        aria-hidden="true"
        className="readout pointer-events-none absolute bottom-6 left-2 z-[1000] sm:bottom-2 shadow-plate-sm"
      >
        {bearing(location.lat, 'N', 'S')} · {bearing(location.lng, 'E', 'W')}
      </span>
    </div>
  )
}
