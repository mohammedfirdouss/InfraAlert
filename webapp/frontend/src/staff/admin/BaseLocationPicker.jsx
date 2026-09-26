/**
 * Small map for choosing a team's base: click to place, drag to adjust, or
 * (from the keyboard) pan the map and place the pin at its centre.
 */
import { useRef } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { Crosshair } from 'lucide-react'
import { config } from '../../config.js'
import { markerIcon, tileLayer } from '../../map.js'

function MapBridge({ mapRef, onPick }) {
  mapRef.current = useMap()
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

/** Six decimals is ~10 cm: plenty, and keeps payloads tidy. */
const round = (n) => Math.round(n * 1e6) / 1e6

/**
 * @param {{
 *   value: { lat: number, lng: number } | null,
 *   onChange: (point: { lat: number, lng: number }) => void,
 *   invalid?: boolean,
 *   describedBy?: string,
 * }} props
 */
export default function BaseLocationPicker({ value, onChange, invalid = false, describedBy }) {
  const mapRef = useRef(null)
  const pick = (point) => onChange({ lat: round(point.lat), lng: round(point.lng) })
  const start = value ?? config.mapDefaultCenter

  function placeAtCentre() {
    const centre = mapRef.current?.getCenter?.()
    if (centre) pick({ lat: centre.lat, lng: centre.lng })
  }

  return (
    <div>
      <div
        className={`relative z-0 h-52 overflow-hidden rounded-md border-2 bg-concrete-200 ${
          invalid ? 'border-hazard-500' : 'border-ink'
        }`}
        aria-describedby={describedBy}
      >
        <MapContainer
          center={[start.lat, start.lng]}
          zoom={value ? 14 : config.mapDefaultZoom}
          className="h-full w-full"
          scrollWheelZoom={false}
        >
          <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
          <MapBridge mapRef={mapRef} onPick={pick} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={markerIcon}
              draggable
              eventHandlers={{
                dragend: (event) => pick(event.target.getLatLng()),
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="readout" aria-live="polite">
          {value ? (
            <>
              <span className="text-asphalt-400">LAT</span>
              <span>{value.lat.toFixed(5)}</span>
              <span className="ml-1 text-asphalt-400">LNG</span>
              <span>{value.lng.toFixed(5)}</span>
            </>
          ) : (
            <span className="text-asphalt-400">No base set</span>
          )}
        </p>
        <button type="button" className="btn-ghost text-sm" onClick={placeAtCentre}>
          <Crosshair size={16} strokeWidth={2.25} aria-hidden="true" />
          Place at map centre
        </button>
      </div>
      <p className="hint">Click the map to set the base, then drag the pin to adjust.</p>
    </div>
  )
}
