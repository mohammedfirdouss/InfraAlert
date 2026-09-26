import { Link } from 'react-router-dom'
import { Cpu } from 'lucide-react'
import { formatDateTime } from '../ui.jsx'
import { describeAudit } from './format.js'

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')

/**
 * Build a team-id → name resolver from everything the page knows about teams.
 * @param {{ incident: import('../api.js').IncidentDetail, candidateTeams: import('../api.js').CandidateTeam[] }} args
 */
export function teamNameResolver({ incident, candidateTeams }) {
  const names = new Map()
  for (const t of candidateTeams) names.set(t.id, t.name)
  for (const a of incident.assignments) names.set(a.team.id, a.team.name)
  for (const t of [incident.item.suggested_team, incident.item.assigned_team]) if (t) names.set(t.id, t.name)
  return (id) => (id ? names.get(id) ?? 'a team' : 'no team')
}

/**
 * The assignment an "assigned"/"reassigned" audit entry created: same team,
 * assigned closest to the entry's time.
 */
function assignmentFor(entry, assignments) {
  const teamId = entry.detail?.team_id
  if (!teamId) return null
  const at = new Date(entry.at).getTime()
  let best = null
  for (const a of assignments) {
    if (a.team.id !== teamId) continue
    if (!best || Math.abs(new Date(a.assigned_at) - at) < Math.abs(new Date(best.assigned_at) - at)) best = a
  }
  return best
}

/**
 * The audit trail, newest first: who (a named person, or the system) did what,
 * when. Assignment entries also say whether the team is still on it.
 *
 * @param {{ incident: import('../api.js').IncidentDetail, candidateTeams: import('../api.js').CandidateTeam[] }} props
 */
export default function ActivityTimeline({ incident, candidateTeams }) {
  const teamName = teamNameResolver({ incident, candidateTeams })
  const entries = incident.audit

  return (
    <section aria-labelledby="activity-title" className="card p-4">
      <h2 id="activity-title" className="section-title">
        Activity
      </h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-asphalt-500">Nothing recorded yet.</p>
      ) : (
        <ol className="relative mt-3 space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-0.5 before:bg-concrete-200">
          {entries.map((entry, i) => {
            const system = entry.staff_name == null
            const line = describeAudit(entry, teamName)
            const notes = [...line.notes]
            if (entry.action === 'incident.assigned' || entry.action === 'incident.reassigned') {
              const a = assignmentFor(entry, incident.assignments)
              if (a) notes.push(a.ended_at ? `released ${formatDateTime(a.ended_at)}` : 'still assigned')
            }
            return (
              <li key={`${entry.at}-${i}`} className="relative flex gap-3" data-actor={system ? 'system' : 'staff'}>
                <span
                  aria-hidden="true"
                  className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    system
                      ? 'border-2 border-dashed border-asphalt-400 bg-concrete-50 text-asphalt-500'
                      : 'border-2 border-ink bg-signal-400 text-ink'
                  }`}
                >
                  {system ? <Cpu size={14} strokeWidth={2.5} /> : initials(entry.staff_name)}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <span className={system ? 'font-semibold text-asphalt-600' : 'font-bold'}>{line.actor}</span>{' '}
                    {line.text}
                    {line.link && (
                      <>
                        {' '}
                        <Link to={line.link.to} className="font-mono font-semibold underline decoration-2 underline-offset-2">
                          {line.link.label}
                        </Link>
                      </>
                    )}
                    {notes.length > 0 && <span className="text-asphalt-600"> · {notes.join(' · ')}</span>}
                  </p>
                  <time dateTime={entry.at} className="text-xs text-asphalt-500">
                    {formatDateTime(entry.at)}
                  </time>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
