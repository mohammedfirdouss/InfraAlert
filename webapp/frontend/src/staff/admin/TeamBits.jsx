/**
 * Small display pieces for teams: status, skill chips and the base readout.
 */
import { Link } from 'react-router-dom'
import { IssueTypeLabel } from '../ui.jsx'

/** Short, readable incident reference, e.g. "INC 3F2A9C01". */
import { incidentRef } from '../ui.jsx'

export { incidentRef }

/** @param {{ lat: number, lng: number }} point */
export const formatLatLng = (point) => `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`

/**
 * Available (no open assignment), On INC xxxx (links to it), Inactive.
 * A deactivated team can still be finishing an assignment, so both show.
 * @param {{ team: import('../api.js').Team }} props
 */
export function TeamStatus({ team }) {
  const busy = team.busy_with_incident_id
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {busy && (
        <Link
          to={`/staff/incidents/${busy}`}
          className="inline-flex items-center gap-1 rounded-full border border-ink bg-signal-100 px-2 py-0.5 text-xs font-bold text-ink underline decoration-signal-600 underline-offset-2 hover:bg-signal-200"
        >
          On <span className="font-mono">{incidentRef(busy)}</span>
        </Link>
      )}
      {!team.active && <span className="tag">Inactive</span>}
      {team.active && !busy && (
        <span className="inline-flex items-center rounded-full border border-go-600 bg-go-50 px-2 py-0.5 text-xs font-bold text-go-700">
          Available
        </span>
      )}
    </span>
  )
}

/** @param {{ skills: string[] }} props */
export function SkillChips({ skills }) {
  if (!skills.length) return <span className="text-xs italic text-asphalt-500">No skills</span>
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Skills">
      {skills.map((skill) => (
        <li
          key={skill}
          className="rounded border border-concrete-300 bg-concrete-100 px-1.5 py-0.5 text-xs font-semibold text-asphalt-700"
        >
          <IssueTypeLabel value={skill} className="[&>svg]:h-3.5 [&>svg]:w-3.5" />
        </li>
      ))}
    </ul>
  )
}
