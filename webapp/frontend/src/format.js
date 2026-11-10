/**
 * Small formatting helpers shared by the citizen pages and the staff app.
 * Staff-only helpers live in src/staff/ui.jsx.
 */

/** "-1.28333, 36.81667": a point to 5 decimals (about a metre). @param {{ lat: number, lng: number }} point */
export const formatLatLng = (point) => `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
