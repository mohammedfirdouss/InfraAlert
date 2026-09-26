/**
 * Pure helpers for the incident page: references, which actions a status
 * allows, plain-language error messages, and readable audit lines.
 */
import { ApiError } from '../../api/client.js'
import { ISSUE_TYPES } from '../ui.jsx'

/** "INC 1A2B3C4D": the first 8 hex digits of the id, for speaking over the radio. */
export function shortRef(id) {
  if (!id) return 'INC ?'
  return `INC ${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export const OPEN_STATUSES = new Set(['new', 'triaged', 'assigned', 'on_site'])

/**
 * The actions the backend's state machine accepts from `status`
 * (webapp/backend/infraalert/staff/dispatch.py).
 * @param {string} status
 */
export function allowedActions(status) {
  const open = OPEN_STATUSES.has(status)
  return {
    triage: status === 'new' || status === 'triaged',
    assign: status === 'new' || status === 'triaged' || status === 'assigned',
    reassign: status === 'assigned',
    onSite: status === 'assigned',
    resolve: status === 'assigned' || status === 'on_site',
    close: open,
    merge: open,
    split: open,
  }
}

export const issueTypeName = (value) =>
  ISSUE_TYPES.find((t) => t.value === value)?.label ?? (value ? 'Other' : 'Unclassified')

/**
 * The issue type most reports' extraction suggested (ties: the earliest report's), or null.
 * @param {{ issue_type: string | null }[]} reports
 */
export function suggestedIssueType(reports) {
  const counts = new Map()
  for (const report of reports) {
    if (report.issue_type) counts.set(report.issue_type, (counts.get(report.issue_type) ?? 0) + 1)
  }
  let best = null
  for (const [type, count] of counts) {
    if (best === null || count > counts.get(best)) best = type
  }
  return best
}

/** Extraction confidence below this is shown as low (matches the worker's MIN_CONFIDENCE). */
export const LOW_CONFIDENCE = 0.6

/**
 * A plain message for a failed action.
 * @param {unknown} error
 * @param {{ teamName?: string }} [context]
 */
export function errorMessage(error, context = {}) {
  const team = context.teamName ?? 'That team'
  if (!(error instanceof ApiError)) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  switch (error.detail) {
    case 'team_busy':
      return `${team} was just assigned elsewhere. Pick another team.`
    case 'team_unavailable':
      return `${team} is no longer active. Pick another team.`
    case 'already_assigned':
      return `${team} is already assigned to this incident.`
    case 'classify_first':
      return 'Set the issue type before assigning a team.'
    case 'invalid_transition':
      return 'Someone else changed this incident a moment ago. The page is up to date now; check its status and try again.'
    case 'cannot_merge_into_itself':
      return "An incident can't be merged into itself. Pick a different one."
    case 'cannot_split_all_reports':
      return 'Leave at least one report on this incident. To move them all, merge it instead.'
    case 'reports_not_in_incident':
      return 'Some of those reports are no longer on this incident. The page is up to date now; select again.'
    case 'incident_not_found':
      return "That incident doesn't exist. Check the ID."
    default:
      if (error.status === 403) return "You don't have permission to do that."
      if (error.status === 422) return 'Check what you entered and try again.'
      return 'Something went wrong on our side. Try again.'
  }
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

/**
 * Turn what a dispatcher pasted into an incident id: a full UUID, or a short
 * reference ("INC 1A2B3C4D" / "1a2b3c4d") matching one of the known incidents.
 * @param {string} text @param {{ id: string }[]} known
 * @returns {string | null}
 */
export function parseIncidentId(text, known = []) {
  const trimmed = text.trim()
  if (UUID_RE.test(trimmed)) {
    const hex = trimmed.replace(/-/g, '').toLowerCase()
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  const short = trimmed.replace(/^inc\s*/i, '').replace(/-/g, '').toLowerCase()
  if (/^[0-9a-f]{8}$/.test(short)) {
    const match = known.find((i) => i.id.replace(/-/g, '').toLowerCase().startsWith(short))
    return match ? match.id : null
  }
  return null
}

/**
 * A readable audit line. `teamName(id)` resolves team ids in the detail.
 * @param {{ action: string, staff_name: string | null, detail: Record<string, any> }} entry
 * @param {(id: string | null | undefined) => string} teamName
 * @returns {{ actor: string, text: string, notes: string[], link?: { to: string, label: string } }}
 */
export function describeAudit(entry, teamName) {
  const actor = entry.staff_name ?? 'System'
  const d = entry.detail ?? {}
  const count = (n) => `${n} report${n === 1 ? '' : 's'}`
  const incidentLink = (id) => (id ? { to: `/staff/incidents/${id}`, label: shortRef(id) } : undefined)
  switch (entry.action) {
    case 'incident.triaged':
      return {
        actor,
        text: `set the type to ${issueTypeName(d.issue_type)}`,
        notes: d.previous && d.previous !== d.issue_type ? [`was ${issueTypeName(d.previous)}`] : [],
      }
    case 'incident.assigned':
    case 'incident.reassigned': {
      const notes = []
      if (d.overridden) notes.push('overrode the suggestion')
      else if (d.suggested_team_id && d.suggested_team_id === d.team_id) notes.push('the suggested team')
      const text =
        entry.action === 'incident.reassigned'
          ? `reassigned from ${teamName(d.previous_team_id)} to ${teamName(d.team_id)}`
          : `assigned ${teamName(d.team_id)}`
      return { actor, text, notes }
    }
    case 'incident.on_site':
      return { actor, text: 'marked the team on site', notes: [] }
    case 'incident.resolved':
      return {
        actor,
        text: 'resolved it',
        notes: [d.team_id ? `${teamName(d.team_id)} released` : null, d.note ? `“${d.note}”` : null].filter(Boolean),
      }
    case 'incident.closed_invalid':
      return { actor, text: 'closed it as invalid', notes: d.reason ? [`“${d.reason}”`] : [] }
    case 'incident.merged':
      return { actor, text: 'merged it into', link: incidentLink(d.into), notes: d.reports != null ? [`${count(d.reports)} moved`] : [] }
    case 'incident.absorbed':
      return { actor, text: 'merged in', link: incidentLink(d.source), notes: d.reports != null ? [`${count(d.reports)} added`] : [] }
    case 'incident.split':
      return { actor, text: `moved ${count(d.reports ?? 0)} to`, link: incidentLink(d.new_incident), notes: [] }
    case 'incident.split_from':
      return { actor, text: `split this off from`, link: incidentLink(d.source), notes: d.reports != null ? [count(d.reports)] : [] }
    case 'report.processed': {
      const notes = [d.matched_existing_incident ? 'grouped with this incident' : 'opened this incident']
      if (typeof d.confidence === 'number') notes.push(`${Math.round(d.confidence * 100)}% confident`)
      if (d.photos_missing) notes.push(`${d.photos_missing} photo${d.photos_missing === 1 ? '' : 's'} missing`)
      return { actor, text: 'read a new report', notes }
    }
    case 'report.needs_triage': {
      const notes = []
      if (typeof d.confidence === 'number') notes.push(`only ${Math.round(d.confidence * 100)}% confident`)
      if (d.extraction_error) notes.push('the reading failed')
      return { actor, text: "couldn't classify a report; it needs a person", notes }
    }
    default:
      return { actor, text: entry.action.replace(/^[a-z]+\./, '').replace(/_/g, ' '), notes: [] }
  }
}
