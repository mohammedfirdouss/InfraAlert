/**
 * Map of sensitive places, linked to the list: hovering a row highlights its
 * feature, hovering or clicking a feature highlights or selects its row.
 * Points are small category-coloured circles, roads are polylines; disabled
 * places are faded and dashed. Drawn on canvas, since an OSM import can hold
 * thousands of places.
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { config } from '../../config.js'
import { tileLayer } from '../../map.js'
import { categoryColour, categoryLabel, toLeaflet, vertices } from './format.js'

const INK = '#14161a'

function styleFor(place, colour) {
  const faded = !place.enabled
  return {
    color: place.geometry.type === 'Point' ? INK : colour,
    weight: place.geometry.type === 'Point' ? 1.5 : 4,
    opacity: faded ? 0.4 : 0.9,
    fillColor: colour,
    fillOpacity: faded ? 0.2 : place.geometry.type === 'Polygon' ? 0.3 : 0.9,
    dashArray: faded ? '4 5' : undefined,
  }
}

/**
 * One place on the map. Memoized on the place object, so hovering a row
 * doesn't redraw thousands of layers; the highlight is a separate overlay.
 */
const Feature = memo(function Feature({ place, colour, onHover, onSelect }) {
  const shape = toLeaflet(place.geometry)
  if (!shape) return null
  const pathOptions = styleFor(place, colour)
  const eventHandlers = {
    mouseover: () => onHover(place.id),
    mouseout: () => onHover(null),
    click: () => onSelect(place.id),
  }
  const common = { pathOptions, eventHandlers, bubblingMouseEvents: false }
  if (shape.kind === 'point') return <CircleMarker center={shape.latlng} radius={6} {...common} />
  if (shape.kind === 'polygon') return <Polygon positions={shape.latlngs} {...common} />
  return <Polyline positions={shape.latlngs} {...common} />
})

/** The hovered or selected place, drawn on top with a thick ink outline and its name. */
function Highlight({ place, colour }) {
  const shape = toLeaflet(place.geometry)
  if (!shape) return null
  const label = (
    <Tooltip permanent direction="top" offset={shape.kind === 'point' ? [0, -10] : [0, 0]}>
      <span className="font-bold">{place.name || 'Unnamed'}</span> · {categoryLabel(place.category)}
      {!place.enabled && ' (disabled)'}
    </Tooltip>
  )
  if (shape.kind === 'point') {
    return (
      <CircleMarker
        center={shape.latlng}
        radius={10}
        pathOptions={{ color: INK, weight: 3, fillColor: colour, fillOpacity: 1 }}
        interactive={false}
      >
        {label}
      </CircleMarker>
    )
  }
  const Shape = shape.kind === 'polygon' ? Polygon : Polyline
  return (
    <>
      <Shape
        positions={shape.latlngs}
        pathOptions={{ color: INK, weight: 9, opacity: 0.9, fill: false }}
        interactive={false}
      />
      <Shape
        positions={shape.latlngs}
        pathOptions={{ color: colour, weight: 5, opacity: 1, fill: false }}
        interactive={false}
      >
        {label}
      </Shape>
    </>
  )
}

/**
 * Fits the map to the city's places once, when they first arrive. While the
 * map is hidden (mobile list view) it has no size, so the fit waits until it
 * is shown.
 */
function FitOnce({ places, visible }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    map.invalidateSize?.()
    if (fitted.current || !places?.length) return
    if (map.getSize?.().x === 0) return
    // Fit to point places: OSM roads carry their full length, far beyond the city.
    const pointPlaces = places.filter((p) => p.geometry?.type === 'Point')
    const points = (pointPlaces.length ? pointPlaces : places).flatMap((p) => vertices(p.geometry))
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], 15)
    else map.fitBounds(points, { padding: [24, 24], maxZoom: 16 })
    fitted.current = true
  }, [map, places, visible])
  return null
}

/**
 * @param {{
 *   places: import('../api.js').Place[] | null,   what the filters let through
 *   allPlaces: import('../api.js').Place[] | null,   everything, for the first fit
 *   categoryIds: string[],
 *   highlightedId: string | null,
 *   onHover: (id: string | null) => void,
 *   onSelect: (id: string) => void,
 *   visible: boolean,
 *   className?: string,
 * }} props
 */
export default function PlacesMap({
  places,
  allPlaces,
  categoryIds,
  highlightedId,
  onHover,
  onSelect,
  visible,
  className = '',
}) {
  const colours = useMemo(
    () => Object.fromEntries(categoryIds.map((id) => [id, categoryColour(id, categoryIds)])),
    [categoryIds],
  )
  const colourOf = (category) => colours[category] ?? categoryColour(category, categoryIds)
  const highlighted = highlightedId ? places?.find((p) => p.id === highlightedId) : null

  return (
    <section
      aria-label="Map of the listed places (visual aid; the list has the same information)"
      className={`relative z-0 overflow-hidden rounded-lg border-2 border-ink bg-concrete-200 ${className}`}
    >
      <MapContainer
        center={[config.mapDefaultCenter.lat, config.mapDefaultCenter.lng]}
        zoom={config.mapDefaultZoom}
        className="h-full w-full"
        preferCanvas
      >
        <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
        {places?.map((place) => (
          <Feature
            key={place.id}
            place={place}
            colour={colourOf(place.category)}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
        {highlighted && (
          <Highlight key={`hl-${highlighted.id}`} place={highlighted} colour={colourOf(highlighted.category)} />
        )}
        <FitOnce places={allPlaces} visible={visible} />
      </MapContainer>

      {categoryIds.length > 0 && (
        <ul
          aria-label="Map key"
          className="pointer-events-none absolute bottom-2 left-2 z-[500] flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-md border border-ink bg-white/95 px-2 py-1.5 text-[11px] font-bold"
        >
          {categoryIds.map((id) => (
            <li key={id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={
                  id === 'major_road' ? 'h-1 w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-full border border-ink'
                }
                style={{ backgroundColor: colourOf(id) }}
              />
              {categoryLabel(id)}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-asphalt-500">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-dashed border-ink opacity-50" />
            Disabled
          </li>
        </ul>
      )}
    </section>
  )
}
