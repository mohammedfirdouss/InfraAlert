/**
 * Pure helpers for the dispatch queue: URL params, tab metadata and the
 * wording of each row's accessible name.
 */
import { HAZARD_LABELS, ISSUE_TYPES, LIFE_SAFETY_HAZARDS, STATUS_LABELS } from '../ui.jsx'

/** @typedef {'triage' | 'open' | 'closed'} QueueTab */

/** @type {QueueTab[]} */
export const QUEUE_TABS = ['triage', 'open', 'closed']
export const DEFAULT_TAB = 'open'

/** @type {Record<QueueTab, string>} */
export const TAB_LABELS = {
  triage: 'Needs triage',
  open: 'Open',
  closed: 'Recently closed',
}

/** @param {string | null} raw @returns {QueueTab} */
export const parseTab = (raw) => (QUEUE_TABS.includes(/** @type {QueueTab} */ (raw)) ? raw : DEFAULT_TAB)

/** @param {string | null} raw @returns {string | null} a known issue type, or null for "all" */
export const parseIssueType = (raw) => (ISSUE_TYPES.some((t) => t.value === raw) ? raw : null)

/** Triage items are unclassified by definition, so the type filter never applies there. */
export const filterApplies = (tab) => tab !== 'triage'

/** @param {string | null} value */
export const issueTypeLabel = (value) =>
  value ? (ISSUE_TYPES.find((t) => t.value === value)?.label ?? 'Other') : 'Unclassified'

/** @param {{ hazard_flags: string[] }} item */
export const hasLifeSafetyHazard = (item) => item.hazard_flags.some((f) => LIFE_SAFETY_HAZARDS.has(f))

/** @param {{ address_text: string | null, location: { lat: number, lng: number } }} item */
export const formatPlace = (item) =>
  item.address_text || `${item.location.lat.toFixed(5)}, ${item.location.lng.toFixed(5)}`

/** @param {number} n */
export const formatReportCount = (n) => `×${n} ${n === 1 ? 'report' : 'reports'}`

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`

/**
 * The spoken twin of formatAge ("3h" → "3 hours ago"), with the same rounding.
 * @param {string} iso @param {number} [now]
 */
export function formatAgeLong(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 48) return plural(hours, 'hour')
  return plural(Math.round(hours / 24), 'day')
}

/** "hh:mm", 24-hour. @param {Date} date */
export const formatClock = (date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

const joinAnd = (parts) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`

/**
 * A row's accessible name, urgency first, e.g.
 * "Critical, pothole, hazard: injury, 3 reports, 2 hours ago, Moi Avenue, New, suggested team Roads 1".
 * @param {import('../api.js').QueueItem} item @param {number} [now]
 */
export function describeItem(item, now = Date.now()) {
  const severity = item.severity
    ? item.severity.charAt(0) + item.severity.slice(1).toLowerCase()
    : 'Unscored'
  const parts = [severity, issueTypeLabel(item.issue_type).toLowerCase()]
  if (item.hazard_flags.length) {
    const flags = [...item.hazard_flags]
      .sort((a, b) => Number(LIFE_SAFETY_HAZARDS.has(b)) - Number(LIFE_SAFETY_HAZARDS.has(a)))
      .map((f) => (HAZARD_LABELS[f] ?? f).toLowerCase())
    parts.push(`${flags.length === 1 ? 'hazard' : 'hazards'}: ${joinAnd(flags)}`)
  }
  parts.push(`${item.report_count} ${item.report_count === 1 ? 'report' : 'reports'}`)
  parts.push(formatAgeLong(item.created_at, now))
  parts.push(formatPlace(item))
  parts.push(STATUS_LABELS[item.status] ?? item.status)
  if (item.assigned_team) parts.push(`assigned to ${item.assigned_team.name}`)
  else if (item.suggested_team) parts.push(`suggested team ${item.suggested_team.name}`)
  return parts.join(', ')
}
