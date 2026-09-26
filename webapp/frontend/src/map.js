/**
 * Shared map settings for every Leaflet map in the app.
 *
 * Production uses MapTiler (hosted OpenStreetMap tiles + geocoding). Without a
 * key we fall back to the public OSM tile server, which is acceptable only for
 * local development under its usage policy, and address search is disabled.
 */
import L from 'leaflet'
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
 * The InfraAlert pin: a signal-yellow plate with an ink crosshair, so the exact
 * point reads clearly on busy street tiles. The tip sits on the coordinate.
 */
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48" aria-hidden="true">
  <ellipse cx="18" cy="45.5" rx="7" ry="2.5" fill="#14161a" opacity=".28"/>
  <path d="M18 44c-1.2 0-12.5-13.6-12.5-24.5a12.5 12.5 0 1 1 25 0C30.5 30.4 19.2 44 18 44Z"
        fill="#ffd60a" stroke="#14161a" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="18" cy="19.5" r="6.5" fill="#fff" stroke="#14161a" stroke-width="2"/>
  <path d="M18 11.5v4.5M18 23v4.5M10 19.5h4.5M21.5 19.5H26" stroke="#14161a" stroke-width="2" stroke-linecap="round"/>
  <circle cx="18" cy="19.5" r="1.8" fill="#14161a"/>
</svg>`

export const markerIcon = L.divIcon({
  className: 'pin-marker',
  html: PIN_SVG,
  iconSize: [36, 48],
  iconAnchor: [18, 44],
  popupAnchor: [0, -40],
})
