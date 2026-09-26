/**
 * InfraAlert citizen API client. Mirrors webapp/backend/infraalert/citizen/api.py.
 * Base URL defaults to same origin; VITE_API_URL overrides it for cross-origin dev.
 */

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

/** An API error. `detail` is the backend's machine-readable code when it sends one. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {unknown} detail  string code (e.g. "captcha_failed") or a validation error list
   */
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    let detail = null
    try {
      detail = (await response.json()).detail ?? null
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, detail)
  }
  return response.json()
}

/**
 * @typedef {'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'} PhotoContentType
 * @typedef {{ object_name: string, upload_url: string, method: string, headers: Record<string, string> }} UploadTarget
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {'received' | 'under_review' | 'team_assigned' | 'in_progress' | 'resolved' | 'closed'} ReportStatus
 * @typedef {{
 *   report_id: string,
 *   status: ReportStatus,
 *   issue_type: string | null,
 *   description: string,
 *   address_text: string | null,
 *   location: LatLng,
 *   photo_count: number,
 *   submitted_at: string,
 *   updates_email_masked: string | null,  // set once someone confirmed email updates
 * }} Report
 */

/** Photo types the backend accepts, and the size limit it signs uploads for. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_PHOTOS_PER_REPORT = 3

/**
 * Ask for a signed upload target for one photo.
 * @param {PhotoContentType} contentType
 * @returns {Promise<UploadTarget>}
 */
export function requestUpload(contentType) {
  return request('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ content_type: contentType }),
  })
}

/**
 * Upload a file to a signed target. Uses XHR so callers can show progress.
 * The target's headers must be sent exactly, or the signature is rejected.
 * @param {UploadTarget} target
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]  0..1
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function uploadPhoto(target, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(target.method, target.upload_url)
    for (const [name, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'upload_failed'))
    xhr.onerror = () => reject(new ApiError(0, 'upload_failed'))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

/**
 * Submit a report. Resolves with { report_id, status: 'received' } (HTTP 202).
 * Rejects with ApiError: 400 'captcha_failed', 409 'photo_already_used',
 * 422 validation errors, 429 'rate_limited'.
 * @param {{
 *   description: string,
 *   location: LatLng,
 *   address_text?: string | null,
 *   photos?: string[],
 *   captcha_token: string,
 * }} body
 * @returns {Promise<{ report_id: string, status: ReportStatus }>}
 */
export function submitReport(body) {
  return request('/api/reports', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * A report's citizen-facing view. Rejects with ApiError 404 when unknown.
 * @param {string} reportId
 * @returns {Promise<Report>}
 */
export function getReport(reportId) {
  return request(`/api/reports/${encodeURIComponent(reportId)}`)
}

// Email updates (ADR 0007). Addresses are only used after the citizen confirms them.

/**
 * Ask for email updates on a report. Always resolves the same way whether or not
 * the address was already subscribed (it never reveals that). A verification
 * email with a link to /reports/:id/verify#token=… is sent.
 * Rejects ApiError: 400 'captcha_failed', 404 'report_not_found', 422 invalid email,
 * 429 'rate_limited'.
 * @param {string} reportId
 * @param {{ email: string, captcha_token: string }} body
 * @returns {Promise<{ status: 'verification_sent' }>}
 */
export function subscribeToUpdates(reportId, body) {
  return request(`/api/reports/${encodeURIComponent(reportId)}/subscribe`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Confirm an address from the verification link. Rejects ApiError 400
 * 'invalid_or_expired_token'.
 * @param {string} reportId
 * @param {string} token  from the link's URL fragment
 * @returns {Promise<{ status: 'subscribed', email_masked: string }>}  e.g. "a•••@gmail.com"
 */
export function verifyUpdates(reportId, token) {
  return request(`/api/reports/${encodeURIComponent(reportId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

/**
 * Stop updates, from the link in any update email (/unsubscribe#token=…).
 * Idempotent. Rejects ApiError 400 'invalid_token'.
 * @param {string} token
 * @returns {Promise<{ status: 'unsubscribed' }>}
 */
export function unsubscribe(token) {
  return request('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ token }) })
}
