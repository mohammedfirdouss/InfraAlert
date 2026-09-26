import { memo, useEffect, useRef } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { config } from '../../config.js'
import { tileLayer } from '../../map.js'

const INK = '#14161a'
/** Severity fills from DESIGN.md: CRITICAL orange, HIGH yellow, MEDIUM white, LOW concrete. */
const FILL = {
  CRITICAL: '#ff5a1f',
  HIGH: '#ffd60a',
  MEDIUM: '#ffffff',
  LOW: '#e7e2d6',
}
const UNSCORED = { color: INK, weight: 2, fillColor: '#f3f0e8', fillOpacity: 1, dashArray: '3 3' }
const PIN_STYLE = Object.fromEntries(
  Object.entries(FILL).map(([sev, fill]) => [sev, { color: INK, weight: 2, fillColor: fill, fillOpacity: 1 }]),
)
const RING_STYLE = { color: INK, weight: 4, fill: false }

/** @param {import('../api.js').QueueItem} item @returns {[number, number]} */
const point = (item) => [item.location.lat, item.location.lng]

/**
 * A severity-coloured circle. Memoized on the (refresh-stable) item, so a
 * refresh or a hover doesn't touch 500 Leaflet layers.
 */
const Pin = memo(function Pin({ item, onSelect }) {
  return (
    <CircleMarker
      center={point(item)}
      radius={item.severity === 'CRITICAL' ? 9 : 7}
      pathOptions={item.severity ? PIN_STYLE[item.severity] : UNSCORED}
      bubblingMouseEvents={false}
      eventHandlers={{ click: () => onSelect(item.id) }}
    />
  )
})

/**
 * Fits the map to the items once per `fitKey` (tab + filter), not on every
 * refresh. While the map is hidden (mobile list view) it has no size, so the
 * fit waits until it's shown.
 */
function MapSync({ items, fitKey, view }) {
  const map = useMap()
  const fitted = useRef(/** @type {string | null} */ (null))
  useEffect(() => {
    map.invalidateSize()
    if (!items?.length || fitted.current === fitKey) return
    if (map.getSize().x === 0) return
    if (items.length === 1) map.setView(point(items[0]), 16)
    else map.fitBounds(items.map(point), { padding: [32, 32], maxZoom: 16 })
    fitted.current = fitKey
  }, [map, items, fitKey, view])
  return null
}

/**
 * The queue's map: a visual aid only; everything on it is also in the list.
 *
 * @param {{
 *   items: import('../api.js').QueueItem[] | undefined,
 *   highlightedId: string | null,
 *   fitKey: string,
 *   view: 'list' | 'map',
 *   onSelect: (id: string) => void,
 * }} props
 */
export default function QueueMap({ items, highlightedId, fitKey, view, onSelect }) {
  const highlighted = highlightedId ? items?.find((i) => i.id === highlightedId) : null
  return (
    <section
      aria-label="Map of the listed incidents (visual aid; the list has the same information)"
      className="relative h-full w-full overflow-hidden rounded-lg border-2 border-ink bg-concrete-200"
    >
      <MapContainer
        center={[config.mapDefaultCenter.lat, config.mapDefaultCenter.lng]}
        zoom={config.mapDefaultZoom}
        className="h-full w-full"
      >
        <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
        {items?.map((item) => (
          <Pin key={item.id} item={item} onSelect={onSelect} />
        ))}
        {highlighted && (
          // Drawn last, so the selection ring sits above neighbouring pins.
          <CircleMarker
            key={`ring-${highlighted.id}`}
            center={point(highlighted)}
            radius={13}
            pathOptions={RING_STYLE}
            interactive={false}
          />
        )}
        <MapSync items={items} fitKey={fitKey} view={view} />
      </MapContainer>
    </section>
  )
}
