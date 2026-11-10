/**
 * Pure helpers for the dispatch queue: URL params, tab metadata and the
 * wording of each row's accessible name.
 */
import { formatLatLng } from '../../format.js'
import {
  HAZARD_LABELS,
  ISSUE_TYPES,
  LIFE_SAFETY_HAZARDS,
  STATUS_LABELS,
  ageOf,
  issueTypeLabel,
  lifeSafetyFirst,
  reportCount,
} from '../ui.jsx'

/** @typedef {'triage' | 'open' | 'closed'} QueueTab */

/** @type {QueueTab[]} */
export const QUEUE_TABS = ['triage', 'open', 'closed']
const DEFAULT_TAB = 'open'

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

/** @param {{ hazard_flags: string[] }} item */
export const hasLifeSafetyHazard = (item) => item.hazard_flags.some((f) => LIFE_SAFETY_HAZARDS.has(f))

/** @param {{ address_text: string | null, location: { lat: number, lng: number } }} item */
export const formatPlace = (item) => item.address_text || formatLatLng(item.location)

/** @param {number} n */
export const formatReportCount = (n) => `×${reportCount(n)}`

/**
 * The spoken twin of formatAge ("3h" → "3 hours ago"), with the same rounding.
 * @param {string} iso @param {number} [now]
 */
export function formatAgeLong(iso, now = Date.now()) {
  const { value, unit } = ageOf(iso, now)
  if (value === 0) return 'just now'
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
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
      .sort(lifeSafetyFirst)
      .map((f) => (HAZARD_LABELS[f] ?? f).toLowerCase())
    parts.push(`${flags.length === 1 ? 'hazard' : 'hazards'}: ${joinAnd(flags)}`)
  }
  parts.push(reportCount(item.report_count))
  parts.push(formatAgeLong(item.created_at, now))
  parts.push(formatPlace(item))
  parts.push(STATUS_LABELS[item.status] ?? item.status)
  if (item.assigned_team) parts.push(`assigned to ${item.assigned_team.name}`)
  else if (item.suggested_team) parts.push(`suggested team ${item.suggested_team.name}`)
  return parts.join(', ')
}
