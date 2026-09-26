/**
 * Map of team bases. Linked to the list by hover: hovering a row lifts its
 * pin and fades the others; hovering a pin highlights the row.
 */
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { config } from '../../config.js'
import { markerIcon, tileLayer } from '../../map.js'

/** Fits the view to the bases whenever the set of teams changes. */
function FitToBases({ points }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14)
    } else {
      map.fitBounds(
        points.map((p) => [p.lat, p.lng]),
        { padding: [32, 32], maxZoom: 15 },
      )
    }
  }, [map, key])
  return null
}

/**
 * @param {{
 *   teams: import('../api.js').Team[],
 *   hoveredId: string | null,
 *   onHover: (id: string | null) => void,
 *   onSelect?: (id: string) => void,
 *   className?: string,
 * }} props
 */
export default function TeamsMap({ teams, hoveredId, onHover, onSelect, className = '' }) {
  const points = useMemo(() => teams.map((t) => t.base_location), [teams])
  return (
    <div
      className={`relative z-0 overflow-hidden rounded-lg border-2 border-ink bg-concrete-200 ${className}`}
      role="region"
      aria-label="Map of team bases"
    >
      <MapContainer
        center={[config.mapDefaultCenter.lat, config.mapDefaultCenter.lng]}
        zoom={config.mapDefaultZoom}
        className="h-full w-full"
        scrollWheelZoom={false}
      >
        <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
        <FitToBases points={points} />
        {teams.map((team) => {
          const hovered = hoveredId === team.id
          const faded = hoveredId ? !hovered : !team.active
          return (
            <Marker
              key={team.id}
              position={[team.base_location.lat, team.base_location.lng]}
              icon={markerIcon}
              title={team.name}
              alt={`${team.name} base`}
              opacity={faded ? 0.45 : 1}
              zIndexOffset={hovered ? 1000 : 0}
              eventHandlers={{
                mouseover: () => onHover(team.id),
                mouseout: () => onHover(null),
                click: () => onSelect?.(team.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -40]}>
                <span className="font-bold">{team.name}</span>
                {!team.active && ' (inactive)'}
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
