import { describe, expect, it } from 'vitest'
import {
  categoryColour,
  categoryLabel,
  filterPlaces,
  formatWeight,
  NO_FILTERS,
  sortPlaces,
  toLeaflet,
  vertices,
} from './format.js'

describe('labels', () => {
  it('names categories and weights', () => {
    expect(categoryLabel('fire_station')).toBe('Fire station')
    expect(formatWeight(1)).toBe('×1.0')
    expect(formatWeight(0.9)).toBe('×0.9')
    expect(formatWeight(0.85)).toBe('×0.85')
  })

  it('gives unknown categories stable spare colours', () => {
    const ids = ['hospital', 'bus_stop', 'library']
    expect(categoryColour('hospital', ids)).toBe('#ff5a1f')
    expect(categoryColour('bus_stop', ids)).not.toBe(categoryColour('library', ids))
    expect(categoryColour('bus_stop', ids)).toBe(categoryColour('bus_stop', ids))
  })
})

describe('geometry', () => {
  it('flips GeoJSON [lng, lat] into Leaflet [lat, lng]', () => {
    expect(toLeaflet({ type: 'Point', coordinates: [36.8, -1.3] })).toEqual({ kind: 'point', latlng: [-1.3, 36.8] })
    expect(
      toLeaflet({
        type: 'LineString',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toEqual({
      kind: 'line',
      latlngs: [
        [2, 1],
        [4, 3],
      ],
    })
    expect(toLeaflet({ type: 'MultiLineString', coordinates: [[[1, 2]], [[3, 4]]] })).toEqual({
      kind: 'line',
      latlngs: [[[2, 1]], [[4, 3]]],
    })
    expect(toLeaflet({ type: 'GeometryCollection', coordinates: [] })).toBeNull()
  })

  it('lists every vertex for fitting the map', () => {
    expect(
      vertices({
        type: 'LineString',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toEqual([
      [2, 1],
      [4, 3],
    ])
    expect(
      vertices({
        type: 'Polygon',
        coordinates: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      }),
    ).toEqual([
      [2, 1],
      [4, 3],
    ])
    expect(vertices({ type: 'MultiLineString', coordinates: [[[1, 2]], [[3, 4]]] })).toEqual([
      [2, 1],
      [4, 3],
    ])
  })
})

describe('filterPlaces and sortPlaces', () => {
  const places = [
    { id: 'a', name: 'Zeta School', category: 'school', source: 'osm', osm_id: 'node/1', enabled: true },
    { id: 'b', name: null, category: 'hospital', source: 'osm', osm_id: 'way/2', enabled: false },
    { id: 'c', name: 'Alpha Clinic', category: 'clinic', source: 'manual', osm_id: null, enabled: true },
  ]

  it('combines filters', () => {
    expect(filterPlaces(places, { ...NO_FILTERS, source: 'osm', status: 'enabled' }).map((p) => p.id)).toEqual(['a'])
    expect(filterPlaces(places, { ...NO_FILTERS, query: ' WAY/2 ' }).map((p) => p.id)).toEqual(['b'])
    expect(filterPlaces(places, { ...NO_FILTERS, category: 'clinic' }).map((p) => p.id)).toEqual(['c'])
  })

  it('sorts A–Z with unnamed places last', () => {
    expect(sortPlaces(places).map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})
