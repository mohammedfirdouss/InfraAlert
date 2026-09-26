/**
 * Teams: every field team, where it's based, what it can fix and whether it's
 * free (ADR 0005). Any staff can look; supervisors and admins create and edit.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, TriangleAlert, X } from 'lucide-react'
import { getTeams } from '../api.js'
import { useStaff } from '../auth.jsx'
import { hasRole } from '../ui.jsx'
import TeamPanel from '../admin/TeamPanel.jsx'
import TeamsMap from '../admin/TeamsMap.jsx'
import { SkillChips, TeamStatus, formatLatLng, incidentRef } from '../admin/TeamBits.jsx'
import { EmptyState, LoadError, SkeletonRows, Toasts, describeError, useToasts } from '../admin/feedback.jsx'

const COLS = 'md:grid md:grid-cols-[minmax(9rem,1.1fr)_minmax(10rem,2fr)_minmax(7rem,1fr)_9.5rem_5.5rem] md:items-center md:gap-3'

export default function Teams() {
  const staff = useStaff()?.staff ?? null
  const canEdit = hasRole(staff, 'supervisor')

  const [teams, setTeams] = useState(/** @type {import('../api.js').Team[] | null} */ (null))
  const [loadError, setLoadError] = useState('')
  const [hoveredId, setHoveredId] = useState(/** @type {string | null} */ (null))
  // undefined: closed; null: creating; a team: editing it.
  const [editing, setEditing] = useState(/** @type {import('../api.js').Team | null | undefined} */ (undefined))
  const [busyWarning, setBusyWarning] = useState(/** @type {import('../api.js').Team | null} */ (null))
  const { toasts, notify, dismiss } = useToasts()

  const load = useCallback(() => {
    setLoadError('')
    setTeams(null)
    getTeams()
      .then(setTeams)
      .catch((error) => setLoadError(describeError(error)))
  }, [])

  useEffect(load, [load])

  function handleSaved(saved, warning) {
    const creating = editing === null
    setTeams((list) => {
      const rest = (list ?? []).filter((t) => t.id !== saved.id)
      return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setEditing(undefined)
    setBusyWarning(warning === 'team_busy_until_assignment_ends' ? saved : null)
    notify(creating ? `Team “${saved.name}” created.` : `Changes to “${saved.name}” saved.`)
  }

  function focusRow(id) {
    const row = document.getElementById(`team-row-${id}`)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    row?.focus()
  }

  return (
    <div className="space-y-4 p-4 text-sm lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Teams</h1>
          <p className="text-asphalt-500">
            {canEdit
              ? 'Field teams, their skills and bases. A team is available when it has no open assignment.'
              : 'Field teams, their skills and bases. Supervisors can add and change teams.'}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setEditing(null)}>
            <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
            New team
          </button>
        )}
      </header>

      {busyWarning && (
        <div
          role="alert"
          className="flex animate-rise-in items-start gap-3 rounded-md border-2 border-ink bg-signal-100 px-3 py-2.5"
        >
          <TriangleAlert size={18} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1">
            <strong>{busyWarning.name}</strong> is now inactive but is still working on{' '}
            <Link
              to={`/staff/incidents/${busyWarning.busy_with_incident_id}`}
              className="font-mono font-bold underline decoration-signal-600 underline-offset-2"
            >
              {incidentRef(busyWarning.busy_with_incident_id)}
            </Link>
            . It stays busy until that assignment ends, and won't be suggested for new incidents.
          </p>
          <button
            type="button"
            className="-my-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded"
            onClick={() => setBusyWarning(null)}
            aria-label="Dismiss warning"
          >
            <X size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
        <section aria-label="Team list" className="order-2 overflow-hidden rounded-lg border border-concrete-300 bg-white lg:order-1">
          <div
            aria-hidden="true"
            className={`hidden border-b border-concrete-300 bg-concrete-100 px-4 py-2 text-[11px] font-extrabold uppercase tracking-sign text-asphalt-600 ${COLS}`}
          >
            <span>Team</span>
            <span>Skills</span>
            <span>Status</span>
            <span>Base</span>
            <span className="sr-only">Actions</span>
          </div>

          {loadError ? (
            <LoadError message={`We couldn't load the teams. ${loadError}`} onRetry={load} />
          ) : teams === null ? (
            <SkeletonRows label="Loading teams" />
          ) : teams.length === 0 ? (
            <EmptyState title="No teams yet">
              {canEdit ? 'Add the first team with “New team”.' : 'A supervisor needs to add the field teams.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-concrete-200">
              {teams.map((team) => (
                <li
                  key={team.id}
                  id={`team-row-${team.id}`}
                  tabIndex={-1}
                  aria-label={team.name}
                  onMouseEnter={() => setHoveredId(team.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(team.id)}
                  onBlur={() => setHoveredId(null)}
                  className={`relative grid gap-1.5 px-4 py-2.5 transition-colors ${COLS} ${
                    hoveredId === team.id ? 'bg-signal-100' : ''
                  } ${team.active ? '' : 'text-asphalt-500'}`}
                >
                  {hoveredId === team.id && (
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-signal-400" />
                  )}
                  <span className="font-bold text-ink">{team.name}</span>
                  <SkillChips skills={team.skills} />
                  <TeamStatus team={team} />
                  <span className="font-mono text-xs text-asphalt-600">
                    <span className="sr-only">Base: </span>
                    {formatLatLng(team.base_location)}
                  </span>
                  <span className="md:text-right">
                    {canEdit && (
                      <button
                        type="button"
                        className="btn-ghost -mx-3 text-sm"
                        onClick={() => setEditing(team)}
                        aria-label={`Edit ${team.name}`}
                      >
                        <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
                        Edit
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <TeamsMap
          teams={teams ?? []}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          onSelect={focusRow}
          className="order-1 h-56 lg:sticky lg:top-4 lg:order-2 lg:h-[calc(100vh-10rem)]"
        />
      </div>

      {canEdit && editing !== undefined && (
        <TeamPanel
          key={editing?.id ?? 'new'}
          team={editing}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
        />
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  )
}
