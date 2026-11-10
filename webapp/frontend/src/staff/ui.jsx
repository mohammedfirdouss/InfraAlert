/**
 * Shared staff-side vocabulary and small display components, so every staff
 * page names and colours things the same way (CONTEXT.md, DESIGN.md).
 */
import { CircleHelp } from 'lucide-react'
import { ISSUE_TYPES, ISSUE_TYPE_BY_VALUE } from '../issueTypes.js'

// Defined once in src/issueTypes.js (the citizen status page uses it too).
export { ISSUE_TYPES }

/** "Pothole"; "Other" for a type this build doesn't know; "Unclassified" for none. @param {string | null | undefined} value */
export const issueTypeLabel = (value) =>
  value ? (ISSUE_TYPE_BY_VALUE.get(value)?.label ?? 'Other') : 'Unclassified'

export const HAZARD_LABELS = {
  injury: 'Injury',
  gas_leak: 'Gas leak',
  exposed_wires: 'Exposed wires',
  fire: 'Fire',
  flooding: 'Flooding',
  sewage_overflow: 'Sewage overflow',
  water_contamination: 'Water contamination',
  structural_damage: 'Structural damage',
  blocking_traffic: 'Blocking traffic',
}
/** Hazards that make an incident critical regardless of its score. */
export const LIFE_SAFETY_HAZARDS = new Set(['injury', 'gas_leak', 'exposed_wires', 'fire'])
/** Sort comparator for hazard flags: life-safety ones first, otherwise in the order given. */
export const lifeSafetyFirst = (a, b) => Number(LIFE_SAFETY_HAZARDS.has(b)) - Number(LIFE_SAFETY_HAZARDS.has(a))

export const STATUS_LABELS = {
  new: 'New',
  triaged: 'Triaged',
  assigned: 'Assigned',
  on_site: 'On site',
  resolved: 'Resolved',
  closed_duplicate: 'Merged',
  closed_invalid: 'Closed',
}

export const ROLE_LABELS = { dispatcher: 'Dispatcher', supervisor: 'Supervisor', admin: 'Admin' }
const ROLE_RANK = { dispatcher: 1, supervisor: 2, admin: 3 }
/** @param {{ role: string } | null} staff @param {'dispatcher' | 'supervisor' | 'admin'} minimum */
export const hasRole = (staff, minimum) => Boolean(staff) && ROLE_RANK[staff.role] >= ROLE_RANK[minimum]

/** @param {{ value: string | null }} props */
export function IssueTypeLabel({ value, className = '' }) {
  if (!value) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-asphalt-500 italic ${className}`}>
        <CircleHelp size={16} strokeWidth={2.25} aria-hidden="true" />
        Unclassified
      </span>
    )
  }
  const { label, Icon } = ISSUE_TYPE_BY_VALUE.get(value) ?? ISSUE_TYPE_BY_VALUE.get('other')
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * A priority score to two decimals, truncated rather than rounded so it never
 * crosses a band boundary: 0.547 is MEDIUM and must read 0.54, not 0.55.
 * @param {number} score
 */
export const formatScore = (score) => (Math.floor(score * 100 + 1e-9) / 100).toFixed(2)

const SEVERITY_STYLE = {
  CRITICAL: 'bg-hazard-500 text-white border-ink',
  HIGH: 'bg-signal-400 text-ink border-ink',
  MEDIUM: 'bg-white text-ink border-ink',
  LOW: 'bg-concrete-100 text-asphalt-600 border-concrete-300',
}

/**
 * Severity band as a sign plate, with the score in mono when known.
 * @param {{ severity: string | null, score?: number | null }} props
 */
export function SeverityBadge({ severity, score }) {
  if (!severity) {
    return <span className="tag border-dashed">Unscored</span>
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border-2 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-sign ${SEVERITY_STYLE[severity]}`}
    >
      {severity}
      {score != null && (
        <span className="font-mono font-semibold opacity-80">{formatScore(score)}</span>
      )}
    </span>
  )
}

const STATUS_STYLE = {
  new: 'border-ink bg-white',
  triaged: 'border-ink bg-white',
  assigned: 'border-ink bg-signal-100',
  on_site: 'border-ink bg-signal-300',
  resolved: 'border-go-600 bg-go-50 text-go-700',
  closed_duplicate: 'border-concrete-300 bg-concrete-100 text-asphalt-500',
  closed_invalid: 'border-concrete-300 bg-concrete-100 text-asphalt-500',
}

/** @param {{ status: string }} props */
export function StatusPill({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[status] ?? ''}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** @param {{ flags: string[] }} props  life-safety flags first, in hazard orange */
export function HazardFlags({ flags }) {
  if (!flags?.length) return null
  const sorted = [...flags].sort(lifeSafetyFirst)
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Hazards">
      {sorted.map((flag) => (
        <li
          key={flag}
          className={
            LIFE_SAFETY_HAZARDS.has(flag)
              ? 'rounded bg-hazard-500 px-1.5 py-0.5 text-[11px] font-bold text-white'
              : 'rounded border border-hazard-500 bg-hazard-50 px-1.5 py-0.5 text-[11px] font-bold text-hazard-700'
          }
        >
          {HAZARD_LABELS[flag] ?? flag}
        </li>
      ))}
    </ul>
  )
}

/**
 * How long ago, in the largest unit that reads well: minutes under an hour,
 * hours under two days, then days. The one place the rounding is decided.
 * @param {string} iso @param {number} [now]
 * @returns {{ value: number, unit: 'minute' | 'hour' | 'day' }}
 */
export function ageOf(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return { value: minutes, unit: 'minute' }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return { value: hours, unit: 'hour' }
  return { value: Math.round(hours / 24), unit: 'day' }
}

/**
 * "12m", "3h", "2d": how long ago, compact for dense lists.
 * @param {string} iso @param {number} [now]
 */
export function formatAge(iso, now = Date.now()) {
  const { value, unit } = ageOf(iso, now)
  return `${value}${unit[0]}`
}

/** "1 report", "3 reports". @param {number} n */
export const reportCount = (n) => `${n} ${n === 1 ? 'report' : 'reports'}`

/**
 * The short reference staff use for an incident: "INC 1A2B3C4D".
 * @param {string | null | undefined} id
 */
export function incidentRef(id) {
  if (!id) return 'INC ?'
  return `INC ${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

// Built once: constructing a formatter per call is slow, and the queue formats hundreds of rows.
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** @param {string} iso */
export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso))

/** @param {number} metres */
export const formatDistance = (metres) =>
  metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`

/**
 * A switch: the checkbox and its track. Wrap it in the `<label>` that names it
 * (or pass `aria-label`); the track follows the input's state through `peer`.
 * @param {{ checked: boolean, onChange: (checked: boolean) => void, disabled?: boolean, 'aria-label'?: string }} props
 */
export function Switch({ checked, onChange, disabled, 'aria-label': ariaLabel }) {
  return (
    <>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full border-2 border-ink bg-concrete-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:bg-signal-400 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:opacity-50"
      />
    </>
  )
}

/** The wording shared by every staff error message for a request that never got an answer. */
export const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again."

/**
 * Plain words for a failed request. `messages` maps the backend's detail codes
 * to the caller's own wording; the rest (no permission, rejected input, a
 * server fault, no connection) reads the same everywhere.
 * @param {unknown} error @param {Record<string, string>} [messages]
 */
export function describeError(error, messages = {}) {
  const detail = /** @type {any} */ (error)?.detail
  if (typeof detail === 'string' && messages[detail]) return messages[detail]
  const status = /** @type {any} */ (error)?.status
  if (status === 403) return "You don't have permission to do that."
  if (status === 422) return 'Some of the details were not accepted. Check them and try again.'
  if (status) return 'Something went wrong on our side. Try again in a moment.'
  return NETWORK_ERROR
}
