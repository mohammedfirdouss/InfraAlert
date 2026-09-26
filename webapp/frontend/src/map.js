/**
 * Shared map settings for every Leaflet map in the app.
 *
 * Production uses MapTiler (hosted OpenStreetMap tiles + geocoding). Without a
 * key we fall back to the public OSM tile server, which is acceptable only for
 * local development under its usage policy, and address search is disabled.
 */
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { config } from './config.js'

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const tileLayer = config.maptilerKey
  ? {
      url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${config.maptilerKey}`,
      attribution: `&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ${OSM_ATTRIBUTION}`,
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTRIBUTION,
    }

export const addressSearchEnabled = Boolean(config.maptilerKey)

/**
 * @typedef {{ label: string, lat: number, lng: number }} Place
 */

/**
 * Forward geocoding: address text → candidate places near `near`.
 * @param {string} query
 * @param {{ lat: number, lng: number }} near
 * @param {AbortSignal} [signal]
 * @returns {Promise<Place[]>}
 */
export async function searchAddress(query, near, signal) {
  if (!addressSearchEnabled) return []
  const url =
    `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
    `?key=${config.maptilerKey}&proximity=${near.lng},${near.lat}&limit=5`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Address search failed (HTTP ${response.status})`)
  const body = await response.json()
  return (body.features || []).map((f) => ({
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }))
}

/**
 * Reverse geocoding: point → a human-readable address, or null.
 * @param {{ lat: number, lng: number }} point
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
export async function reverseGeocode(point, signal) {
  if (!addressSearchEnabled) return null
  const url =
    `https://api.maptiler.com/geocoding/${point.lng},${point.lat}.json` +
    `?key=${config.maptilerKey}&limit=1`
  const response = await fetch(url, { signal })
  if (!response.ok) return null
  const body = await response.json()
  return body.features?.[0]?.place_name ?? null
}

/**
 * Leaflet's default marker looks up its images by URL at runtime, which breaks
 * under a bundler; use this explicit icon for every marker instead.
 */
export const markerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})
