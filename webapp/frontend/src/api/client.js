/**
 * InfraAlert API client — thin fetch wrapper over the FastAPI backend.
 * Base URL defaults to same origin (served by FastAPI in production)
 * or can be overridden with VITE_API_URL for cross-origin dev setups.
 */

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      detail = body.detail || body.message || detail
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail)
  }

  return response.json()
}

/**
 * Submit a new infrastructure report.
 * @param {{ description: string, location: string, issue_type: string, citizen_phone?: string, media_urls?: string[] }} data
 * @returns {Promise<object>} ReportResponse
 */
export async function submitReport(data) {
  return request('/api/reports', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/**
 * Get a single report by ID.
 * @param {string} id
 * @returns {Promise<object>} ReportResponse
 */
export async function getReport(id) {
  return request(`/api/reports/${encodeURIComponent(id)}`)
}

/**
 * List all reports.
 * @returns {Promise<{ reports: object[] }>}
 */
export async function getReports() {
  return request('/api/reports')
}

/**
 * Get aggregated infrastructure statistics.
 * @returns {Promise<{ total_reports: number, resolved_today: number, active_teams: number, avg_response_hours: number }>}
 */
export async function getStats() {
  return request('/api/stats')
}

/**
 * Check backend health.
 * @returns {Promise<object>}
 */
export async function getHealth() {
  return request('/api/health')
}
