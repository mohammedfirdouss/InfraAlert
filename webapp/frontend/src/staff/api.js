/**
 * Staff API client. Mirrors webapp/backend/infraalert/staff/api.py (dispatch)
 * and staff/admin_api.py (teams, staff). Every call carries the signed-in
 * staff member's ID token; the auth provider registers how to get it.
 */
import { ApiError } from '../api/client.js'

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

/** @type {() => Promise<string | null>} */
let tokenProvider = async () => null
/** @type {() => void} */
let onSignedOut = () => {}

/**
 * Called once by the staff auth provider.
 * @param {() => Promise<string | null>} getToken
 * @param {() => void} signedOut  called when the backend answers 401
 */
export function configureStaffApi(getToken, signedOut) {
  tokenProvider = getToken
  onSignedOut = signedOut
}

async function request(path, options = {}) {
  const token = await tokenProvider()
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (response.status === 401) onSignedOut()
  if (!response.ok) {
    let detail = null
    try {
      detail = (await response.json()).detail ?? null
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, detail)
  }
  return response.status === 204 ? null : response.json()
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
const patch = (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) })

/**
 * @typedef {'dispatcher' | 'supervisor' | 'admin'} StaffRole
 * @typedef {{ id: string, email: string, display_name: string, role: StaffRole }} Me
 * @typedef {'new' | 'triaged' | 'assigned' | 'on_site' | 'resolved' | 'closed_duplicate' | 'closed_invalid'} IncidentStatus
 * @typedef {'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'} Severity
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{ id: string, name: string }} TeamRef
 * @typedef {{
 *   id: string, status: IncidentStatus, issue_type: string | null,
 *   priority_score: number | null, severity: Severity | null, report_count: number,
 *   hazard_flags: string[], headline: string, address_text: string | null,
 *   location: LatLng, created_at: string,
 *   suggested_team: TeamRef | null, assigned_team: TeamRef | null,
 * }} QueueItem
 * @typedef {{ id: string, url: string, content_type: string }} Photo
 * @typedef {{
 *   id: string, description: string, address_text: string | null, location: LatLng,
 *   submitted_at: string, processing: 'received' | 'processed' | 'needs_triage',
 *   issue_type: string | null, hazard_flags: string[], summary: string | null,
 *   confidence: number | null, photos: Photo[],
 * }} IncidentReport  the extraction fields are hints for the dispatcher (ADR 0004)
 * @typedef {{ team: TeamRef, assigned_by: string, assigned_at: string, ended_at: string | null, overridden: boolean }} AssignmentView
 * @typedef {{ at: string, action: string, staff_name: string | null, detail: Record<string, unknown> }} AuditEntry  staff_name null = the system
 * @typedef {{
 *   item: QueueItem, formula_version: string | null,
 *   priority_inputs: {
 *     issue_type: string, hazard_flags: string[], report_count: number,
 *     nearby_places: { category: string, distance_m: number }[],
 *     components: Record<'hazard' | 'type' | 'place' | 'volume', { value: number, weight: number, contribution: number }>,
 *     floor_applied: boolean,
 *   } | null,
 *   merged_into_id: string | null, resolved_at: string | null,
 *   reports: IncidentReport[], assignments: AssignmentView[], audit: AuditEntry[],
 * }} IncidentDetail
 * @typedef {{ id: string, name: string, skilled: boolean, busy_with_incident_id: string | null, distance_m: number, suggested: boolean }} CandidateTeam
 * @typedef {{ id: string, issue_type: string | null, status: IncidentStatus, distance_m: number, report_count: number, headline: string, location: LatLng }} NearbyIncident
 * @typedef {{ id: string, name: string, skills: string[], base_location: LatLng, active: boolean, busy_with_incident_id: string | null }} Team
 * @typedef {{ id: string, email: string, display_name: string, role: StaffRole, status: 'invited' | 'active' | 'deactivated', created_at: string }} Member
 */

/** @returns {Promise<Me>} */
export const getMe = () => request('/api/staff/me')

// Dispatch

/**
 * @param {'triage' | 'open' | 'closed'} tab
 * @param {string | null} [issueType]
 * @returns {Promise<QueueItem[]>}
 */
export function getQueue(tab, issueType) {
  const params = new URLSearchParams({ tab })
  if (issueType) params.set('issue_type', issueType)
  return request(`/api/staff/queue?${params}`)
}

/** @returns {Promise<{ incident: IncidentDetail, candidate_teams: CandidateTeam[], nearby_incidents: NearbyIncident[] }>} */
export const getIncident = (id) => request(`/api/staff/incidents/${encodeURIComponent(id)}`)

const action = (id, name, body) =>
  post(`/api/staff/incidents/${encodeURIComponent(id)}/${name}`, body)

/*
 * Actions reject with ApiError. Its detail codes are: invalid_transition (409),
 * classify_first, team_unavailable, team_busy, already_assigned,
 * cannot_merge_into_itself, cannot_split_all_reports (409),
 * reports_not_in_incident (422), and incident_not_found (404).
 */
export const triage = (id, issueType) => action(id, 'triage', { issue_type: issueType })
export const assign = (id, teamId) => action(id, 'assign', { team_id: teamId })
export const markOnSite = (id) => action(id, 'on-site')
export const resolve = (id, note) => action(id, 'resolve', { note: note || null })
export const closeInvalid = (id, reason) => action(id, 'close', { reason })
export const merge = (id, intoIncidentId) => action(id, 'merge', { into_incident_id: intoIncidentId })
/** @returns {Promise<{ new_incident_id: string }>} */
export const split = (id, reportIds) => action(id, 'split', { report_ids: reportIds })

// Teams (supervisor+ to change; any staff to read)

/** @returns {Promise<Team[]>} */
export const getTeams = () => request('/api/staff/teams')
/** Rejects 409 team_name_taken. */
export const createTeam = (team) => post('/api/staff/teams', team)
/** Partial update; the response may include warning: 'team_busy_until_assignment_ends'. */
export const updateTeam = (id, changes) => patch(`/api/staff/teams/${encodeURIComponent(id)}`, changes)

// Staff (admin)

/** @returns {Promise<Member[]>} */
export const getMembers = () => request('/api/staff/members')
/** Rejects 409 already_staff. */
export const inviteMember = (member) => post('/api/staff/members', member)
/** Rejects 409 cannot_change_own_access or last_admin. */
export const updateMember = (id, changes) =>
  patch(`/api/staff/members/${encodeURIComponent(id)}`, changes)
