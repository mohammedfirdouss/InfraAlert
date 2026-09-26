/**
 * Pure helpers for the sensitive places page: labels, colours, geometry and
 * filtering. Kept free of React so the list and the map agree, and so the
 * filtering of thousands of OSM places stays cheap and testable.
 */

/** @typedef {import('../api.js').Place} Place */
/** @typedef {import('../api.js').PlaceCategory} PlaceCategory */

/** "fire_station" → "Fire station" */
export function categoryLabel(id) {
  const words = String(id ?? '').replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Uncategorised'
}

/** Priority weight as a multiplier: 1 → "×1.0", 0.85 → "×0.85". */
export function formatWeight(weight) {
  if (typeof weight !== 'number') return ''
  const oneDecimal = Math.abs(weight * 10 - Math.round(weight * 10)) < 1e-9
  return `×${oneDecimal ? weight.toFixed(1) : String(Math.round(weight * 100) / 100)}`
}

/** "Hospital ×1.0" */
export const categoryOptionLabel = (category) => `${categoryLabel(category.id)} ${formatWeight(category.weight)}`

/**
 * Category colours from the design tokens: the most sensitive in the hot
 * colours, roads in asphalt. Unknown categories cycle through the rest.
 */
const KNOWN_COLOURS = {
  hospital: '#ff5a1f', // hazard-500
  clinic: '#b8380a', // hazard-700
  school: '#ffd60a', // signal-400
  fire_station: '#e5480f', // hazard-600
  police: '#2f5bff', // survey-500
  major_road: '#3d424b', // asphalt-600
  market: '#22a35a', // go-500
}
const SPARE_COLOURS = ['#1f45e0', '#136b3a', '#c79f00', '#7b818b', '#b5ad9b']

/** @param {string} category @param {string[]} [allCategories] the page's category ids, for stable spare colours */
export function categoryColour(category, allCategories = []) {
  if (KNOWN_COLOURS[category]) return KNOWN_COLOURS[category]
  const unknown = allCategories.filter((c) => !KNOWN_COLOURS[c])
  const index = Math.max(0, unknown.indexOf(category))
  return SPARE_COLOURS[index % SPARE_COLOURS.length]
}

/** [lng, lat] → [lat, lng] (GeoJSON to Leaflet). */
const flip = ([lng, lat]) => [lat, lng]

/**
 * A place's geometry in Leaflet's [lat, lng] order, tagged with how to draw it.
 * @param {Place['geometry']} geometry
 * @returns {{ kind: 'point', latlng: [number, number] }
 *   | { kind: 'line', latlngs: [number, number][] | [number, number][][] }
 *   | { kind: 'polygon', latlngs: [number, number][][] }
 *   | null}
 */
export function toLeaflet(geometry) {
  const coords = /** @type {any} */ (geometry?.coordinates)
  if (!coords) return null
  switch (geometry.type) {
    case 'Point':
      return { kind: 'point', latlng: flip(coords) }
    case 'LineString':
      return { kind: 'line', latlngs: coords.map(flip) }
    case 'MultiLineString':
      return { kind: 'line', latlngs: coords.map((line) => line.map(flip)) }
    case 'Polygon':
      return { kind: 'polygon', latlngs: coords.map((ring) => ring.map(flip)) }
    default:
      return null
  }
}

/** Every [lat, lng] vertex of a place, for fitting the map. */
export function vertices(geometry) {
  const shape = toLeaflet(geometry)
  if (!shape) return []
  if (shape.kind === 'point') return [shape.latlng]
  return /** @type {any[]} */ (shape.latlngs).flat(Array.isArray(shape.latlngs[0]?.[0]) ? 1 : 0)
}

/** A manual place's point as { lat, lng }, or null for other shapes. */
export function pointOf(geometry) {
  if (geometry?.type !== 'Point') return null
  const [lng, lat] = /** @type {number[]} */ (geometry.coordinates)
  return { lat, lng }
}

export const SHAPE_LABELS = {
  Point: 'Point',
  LineString: 'Road line',
  MultiLineString: 'Road lines',
  Polygon: 'Area',
}

/**
 * @typedef {{ category: string, source: '' | 'osm' | 'manual', status: '' | 'enabled' | 'disabled', query: string }} PlaceFilters
 */
export const NO_FILTERS = /** @type {PlaceFilters} */ ({ category: '', source: '', status: '', query: '' })

/**
 * @param {Place[]} places @param {PlaceFilters} filters
 * @returns {Place[]}
 */
export function filterPlaces(places, { category, source, status, query }) {
  const needle = query.trim().toLowerCase()
  return places.filter(
    (p) =>
      (!category || p.category === category) &&
      (!source || p.source === source) &&
      (!status || (status === 'enabled') === p.enabled) &&
      (!needle || (p.name ?? '').toLowerCase().includes(needle) || (p.osm_id ?? '').toLowerCase().includes(needle)),
  )
}

/** Named places A–Z, unnamed ones last. */
export function sortPlaces(places) {
  return [...places].sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1
    return (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id)
  })
}
