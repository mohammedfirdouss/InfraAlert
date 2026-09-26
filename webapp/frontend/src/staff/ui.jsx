/**
 * Shared staff-side vocabulary and small display components, so every staff
 * page names and colours things the same way (CONTEXT.md, DESIGN.md).
 */
import {
  CircleHelp,
  Construction,
  Droplets,
  Lightbulb,
  TriangleAlert,
  Waves,
  Zap,
} from 'lucide-react'

export const ISSUE_TYPES = [
  { value: 'pothole', label: 'Pothole', Icon: Construction },
  { value: 'road_damage', label: 'Road damage', Icon: TriangleAlert },
  { value: 'water_leak', label: 'Water leak', Icon: Droplets },
  { value: 'sewage', label: 'Sewage', Icon: Waves },
  { value: 'power_outage', label: 'Power outage', Icon: Zap },
  { value: 'broken_streetlight', label: 'Broken streetlight', Icon: Lightbulb },
  { value: 'other', label: 'Other', Icon: CircleHelp },
]
const ISSUE_TYPE_BY_VALUE = Object.fromEntries(ISSUE_TYPES.map((t) => [t.value, t]))

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
  const { label, Icon } = ISSUE_TYPE_BY_VALUE[value] ?? ISSUE_TYPE_BY_VALUE.other
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
  const sorted = [...flags].sort(
    (a, b) => Number(LIFE_SAFETY_HAZARDS.has(b)) - Number(LIFE_SAFETY_HAZARDS.has(a)),
  )
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
 * "12m", "3h", "2d": how long ago, compact for dense lists.
 * @param {string} iso @param {number} [now]
 */
export function formatAge(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * The short reference staff use for an incident: "INC 1A2B3C4D".
 * @param {string | null | undefined} id
 */
export function incidentRef(id) {
  if (!id) return 'INC ?'
  return `INC ${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

/** @param {string} iso */
export const formatDateTime = (iso) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

/** @param {number} metres */
export const formatDistance = (metres) =>
  metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
