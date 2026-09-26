import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import { markerIcon, tileLayer } from '../map.js'

/**
 * LocationPreview: a small read-only map showing where a report is.
 *
 * @param {{ location: { lat: number, lng: number } }} props
 */
export default function LocationPreview({ location }) {
  const center = [location.lat, location.lng]
  return (
    <div
      role="img"
      aria-label={`Map showing the reported location at ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
      className="h-48 w-full overflow-hidden rounded-lg border border-gray-200"
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
    </div>
  )
}
