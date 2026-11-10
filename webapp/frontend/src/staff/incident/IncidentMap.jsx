import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'
import { formatLatLng } from '../../format.js'
import { markerIcon, tileLayer } from '../../map.js'
import { incidentRef, issueTypeLabel, reportCount } from '../ui.jsx'

const INK = '#14161a'

/**
 * The incident pin, its reports' points, and nearby open incidents as small
 * circles; clicking a nearby circle picks it as the merge target.
 *
 * @param {{
 *   incident: import('../api.js').IncidentDetail,
 *   nearby: import('../api.js').NearbyIncident[],
 *   mergeTarget: string | null, canMerge: boolean, onSelectNearby: (id: string) => void,
 * }} props
 */
export default function IncidentMap({ incident, nearby, mergeTarget, canMerge, onSelectNearby }) {
  const { location } = incident.item
  const center = [location.lat, location.lng]

  return (
    <section aria-labelledby="map-title" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 id="map-title" className="section-title">
          Map
        </h2>
        <span className="readout">{formatLatLng(location)}</span>
      </div>
      <div className="relative z-0 m-3 h-64 overflow-hidden rounded-lg border-2 border-ink bg-concrete-200 sm:h-72">
        <MapContainer key={`${incident.item.id}`} center={center} zoom={17} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
          {nearby.map((n) => {
            const selected = n.id === mergeTarget
            return (
              <CircleMarker
                key={n.id}
                center={[n.location.lat, n.location.lng]}
                radius={selected ? 9 : 7}
                pathOptions={{
                  color: INK,
                  weight: selected ? 4 : 2,
                  fillColor: '#ffffff',
                  fillOpacity: 0.9,
                  dashArray: selected ? undefined : '3 3',
                }}
                eventHandlers={canMerge ? { click: () => onSelectNearby(n.id) } : undefined}
              >
                <Tooltip>
                  {incidentRef(n.id)} · {issueTypeLabel(n.issue_type)} · {reportCount(n.report_count)}
                  {canMerge ? ' · click to merge into' : ''}
                </Tooltip>
              </CircleMarker>
            )
          })}
          {incident.reports.map((r, i) => (
            <CircleMarker
              key={r.id}
              center={[r.location.lat, r.location.lng]}
              radius={4}
              pathOptions={{ color: INK, weight: 1.5, fillColor: INK, fillOpacity: 0.85 }}
            >
              <Tooltip>Report #{i + 1}</Tooltip>
            </CircleMarker>
          ))}
          <Marker position={center} icon={markerIcon} keyboard={false} />
        </MapContainer>
      </div>
      <p className="px-4 pb-3 text-xs text-asphalt-500">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-ink align-middle" aria-hidden="true" /> reports
        {nearby.length > 0 && (
          <>
            {' '}
            · <span className="mx-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-ink align-middle" aria-hidden="true" />
            nearby incidents{canMerge ? ' (click one to merge into it)' : ''}
          </>
        )}
      </p>
    </section>
  )
}
