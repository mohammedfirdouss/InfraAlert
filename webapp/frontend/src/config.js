/**
 * Build-time settings (Vite `VITE_*` env vars). See webapp/frontend/.env.example.
 */

const env = import.meta.env

/** Parses "lat,lng" into { lat, lng }, or returns the fallback. */
function parseLatLng(raw, fallback) {
  const parts = (raw || '').split(',').map(Number)
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return { lat: parts[0], lng: parts[1] }
  }
  return fallback
}

export const config = {
  /** MapTiler key for tiles and address search. Empty: OSM dev tiles, no search. */
  maptilerKey: env.VITE_MAPTILER_KEY || '',
  /**
   * Cloudflare Turnstile site key. The default is Cloudflare's always-pass
   * test key, which pairs with the backend's test secret in .env.example.
   */
  turnstileSiteKey: env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
  /** Where the map opens before the citizen's location is known. */
  mapDefaultCenter: parseLatLng(env.VITE_MAP_DEFAULT_CENTER, { lat: -1.2921, lng: 36.8219 }),
  mapDefaultZoom: 13,
  /** Emergency number shown on the report form (ADR 0005). */
  emergencyNumber: env.VITE_EMERGENCY_NUMBER || '112',

  /**
   * Staff sign-in (ADR 0007). "dev" signs in by typing a seeded staff email and
   * only works against a backend running STAFF_AUTH_BACKEND=dev.
   */
  staffAuth: env.VITE_STAFF_AUTH === 'identity_platform' ? 'identity_platform' : 'dev',
  /** Google Identity Platform (Firebase Auth) web config, for identity_platform. */
  firebase: {
    apiKey: env.VITE_FIREBASE_API_KEY || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  },
  /** The Identity Platform provider id of the city's SSO, e.g. "oidc.city-sso". */
  staffSignInProvider: env.VITE_STAFF_SIGN_IN_PROVIDER || '',
}
