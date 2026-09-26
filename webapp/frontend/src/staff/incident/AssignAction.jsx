import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { formatDistance } from '../ui.jsx'
import { issueTypeName, shortRef } from './format.js'
import { ActionError, Plate, useAction } from './Plate.jsx'

/** Skilled and free first, then free but unskilled, then busy; nearest first within each. */
function rank(team, incidentId) {
  if (team.busy_with_incident_id) return team.busy_with_incident_id === incidentId ? 3 : 2
  return team.skilled ? 0 : 1
}

/**
 * Pick a team. The system's suggestion is the default; picking another is an
 * explicit, recorded override (ADR 0005). Busy teams can't be picked.
 *
 * @param {{
 *   incidentId: string, issueType: string | null, teams: import('../api.js').CandidateTeam[],
 *   currentTeam: { id: string, name: string } | null, primary: boolean,
 *   onAssign: (team: import('../api.js').CandidateTeam) => Promise<{ ok: boolean, message?: string }>,
 * }} props
 */
export default function AssignAction({ incidentId, issueType, teams, currentTeam, primary, onAssign }) {
  const reassigning = Boolean(currentTeam)
  const [open, setOpen] = useState(!reassigning)
  const sorted = useMemo(
    () =>
      [...teams].sort(
        (a, b) => rank(a, incidentId) - rank(b, incidentId) || a.distance_m - b.distance_m,
      ),
    [teams, incidentId],
  )
  const suggested = teams.find((t) => t.suggested) ?? null
  const selectable = (t) => !t.busy_with_incident_id
  const [choiceId, setChoiceId] = useState(
    suggested && selectable(suggested) ? suggested.id : null,
  )
  const choice = teams.find((t) => t.id === choiceId && selectable(t)) ?? null
  const { run, pending, error } = useAction(onAssign)

  if (!issueType) {
    return (
      <Plate title="Assign a team">
        <p className="text-sm text-asphalt-600">Classify this incident first; teams are matched by issue type.</p>
      </Plate>
    )
  }

  if (!open) {
    return (
      <Plate title="Team">
        <p className="text-sm">
          <span className="font-bold">{currentTeam?.name}</span> is on this incident.
        </p>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => setOpen(true)}>
          Reassign
        </button>
      </Plate>
    )
  }

  const overriding = Boolean(choice && suggested && choice.id !== suggested.id)

  return (
    <Plate title={reassigning ? 'Reassign' : 'Assign a team'}>
      {teams.length === 0 ? (
        <p className="text-sm text-asphalt-600">
          There are no active teams. A supervisor can add one on the Teams page.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (choice) run(choice)
          }}
        >
          <fieldset>
            <legend className="sr-only">Team</legend>
            <ul className="divide-y divide-concrete-200 rounded-md border border-concrete-300">
              {sorted.map((team) => {
                const busy = Boolean(team.busy_with_incident_id)
                const here = team.busy_with_incident_id === incidentId
                return (
                  <li key={team.id} className={`flex items-center gap-2 px-2 ${busy ? 'bg-concrete-50' : ''}`}>
                    <label
                      className={`flex min-h-[44px] flex-1 items-center gap-2 text-sm ${
                        busy ? 'cursor-not-allowed text-asphalt-400' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="team"
                        value={team.id}
                        disabled={busy}
                        checked={choiceId === team.id && !busy}
                        onChange={() => setChoiceId(team.id)}
                        className="h-4 w-4 accent-ink"
                      />
                      <span className="font-bold">{team.name}</span>
                      {team.suggested && (
                        <span className="rounded border border-dashed border-asphalt-400 px-1 text-[10px] font-bold uppercase tracking-sign text-asphalt-500">
                          Suggested
                        </span>
                      )}
                      {!team.skilled && !busy && (
                        <span className="text-[11px] font-semibold text-hazard-700">Not skilled</span>
                      )}
                      <span className="ml-auto font-mono text-xs text-asphalt-500">{formatDistance(team.distance_m)}</span>
                    </label>
                    {busy &&
                      (here ? (
                        <span className="text-xs font-semibold text-asphalt-500">Assigned here</span>
                      ) : (
                        <Link
                          to={`/staff/incidents/${team.busy_with_incident_id}`}
                          className="font-mono text-xs underline decoration-2 underline-offset-2"
                        >
                          On {shortRef(team.busy_with_incident_id)}
                        </Link>
                      ))}
                  </li>
                )
              })}
            </ul>
          </fieldset>

          {!suggested && (
            <p className="hint">No free team has the skills for this; the system has no suggestion.</p>
          )}
          {overriding && (
            <p className="mt-2 rounded-md border-2 border-ink bg-signal-100 px-2 py-1.5 text-[13px] font-semibold" role="note">
              You&apos;re overriding the suggestion ({suggested.name}). This is recorded.
            </p>
          )}
          {choice && !choice.skilled && (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-hazard-700">
              <TriangleAlert size={14} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden="true" />
              {choice.name} isn&apos;t skilled for {issueTypeName(issueType).toLowerCase()}. You can still send them.
            </p>
          )}
          <ActionError message={error} />
          <div className="mt-3 flex gap-2">
            <button type="submit" className={`${primary ? 'btn-primary' : 'btn-secondary'} flex-1`} disabled={!choice || pending}>
              {pending
                ? 'Assigning…'
                : choice
                  ? `${reassigning ? 'Reassign to' : 'Assign'} ${choice.name}`
                  : 'Pick a team'}
            </button>
            {reassigning && (
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </Plate>
  )
}
