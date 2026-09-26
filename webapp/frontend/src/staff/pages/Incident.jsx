/**
 * Incident detail and dispatch actions: inspect one incident, verify the
 * system's hints, and act on it (ADR 0004, 0005, 0006).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client.js'
import * as api from '../api.js'
import ActionsPanel from '../incident/ActionsPanel.jsx'
import ActivityTimeline from '../incident/ActivityTimeline.jsx'
import IncidentHeader from '../incident/IncidentHeader.jsx'
import IncidentMap from '../incident/IncidentMap.jsx'
import PriorityPanel from '../incident/PriorityPanel.jsx'
import ReportsList from '../incident/ReportsList.jsx'
import { OPEN_STATUSES, errorMessage, issueTypeName, shortRef } from '../incident/format.js'
import { useIncident } from '../incident/useIncident.js'

export default function Incident() {
  const { id } = useParams()
  const [toast, setToast] = useState(/** @type {{ text: string, n: number } | null} */ (null))
  const notify = useCallback((text) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 })), [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <>
      {/* Keyed so a split's navigation to the new incident starts fresh. */}
      <IncidentView key={id} id={id} notify={notify} />
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[1500] max-w-sm"
      >
        {toast && (
          <p
            key={toast.n}
            className="animate-rise-in rounded-lg border-2 border-go-600 bg-go-50 px-4 py-3 text-sm font-bold text-go-700 shadow-lift"
          >
            {toast.text}
          </p>
        )}
      </div>
    </>
  )
}

/** @param {{ id: string, notify: (text: string) => void }} props */
function IncidentView({ id, notify }) {
  const navigate = useNavigate()
  const { data, error, loading, reload, retry, onPhotoError } = useIncident(id)
  const [selectedReports, setSelectedReports] = useState(/** @type {string[]} */ ([]))
  const [mergeTarget, setMergeTarget] = useState(/** @type {string | null} */ (null))
  const actionsRef = useRef(/** @type {HTMLElement | null} */ (null))

  // Drop selections that no longer apply after a refetch.
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.incident.reports.map((r) => r.id))
    setSelectedReports((sel) => (sel.every((r) => ids.has(r)) ? sel : sel.filter((r) => ids.has(r))))
  }, [data])

  /**
   * Run one API action: on success, refetch and announce; on failure, refetch
   * too (the incident may have changed under us) and return a plain message.
   */
  const act = useCallback(
    async (call, success, context) => {
      try {
        const result = await call()
        notify(typeof success === 'function' ? success(result) : success)
        await reload()
        return { ok: true, result }
      } catch (err) {
        reload()
        return { ok: false, message: errorMessage(err, context) }
      }
    },
    [notify, reload],
  )

  const actions = useMemo(() => {
    const ref = shortRef(id)
    return {
      triage: (type) => act(() => api.triage(id, type), `Type set to ${issueTypeName(type)}.`),
      assign: (team) =>
        act(() => api.assign(id, team.id), `${team.name} assigned to ${ref}.`, { teamName: team.name }),
      onSite: () => act(() => api.markOnSite(id), 'Marked on site.'),
      resolve: (note) => act(() => api.resolve(id, note), `${ref} resolved. Citizens will be told.`),
      close: (reason) => act(() => api.closeInvalid(id, reason), `${ref} closed as invalid.`),
      merge: (intoId) =>
        act(() => api.merge(id, intoId), `${ref} merged into ${shortRef(intoId)}.`).then((outcome) => {
          if (outcome.ok) setMergeTarget(null)
          return outcome
        }),
      split: async (reportIds) => {
        try {
          const { new_incident_id: newId } = await api.split(id, reportIds)
          notify(
            `Moved ${reportIds.length} report${reportIds.length === 1 ? '' : 's'} to ${shortRef(newId)}.`,
          )
          navigate(`/staff/incidents/${newId}`)
          return { ok: true }
        } catch (err) {
          reload()
          return { ok: false, message: errorMessage(err) }
        }
      },
    }
  }, [act, id, navigate, notify, reload])

  const selectNearby = useCallback((nearbyId) => {
    setMergeTarget(nearbyId)
    actionsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])

  if (loading && !data) return <Skeleton />

  if (!data) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <p className="readout">{shortRef(id)}</p>
          <h1 className="mt-3 text-2xl font-black">This incident doesn&apos;t exist</h1>
          <p className="mt-2 text-sm text-asphalt-600">Check the link, or find it from the queue.</p>
          <Link to="/staff" className="btn-secondary mt-6">
            Back to queue
          </Link>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-lg py-16 text-center" role="alert">
        <h1 className="text-2xl font-black">Couldn&apos;t load this incident</h1>
        <p className="mt-2 text-sm text-asphalt-600">
          {error instanceof ApiError ? 'The server had a problem.' : 'Check your connection.'} Try again in a moment.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={retry}>
            Try again
          </button>
          <Link to="/staff" className="btn-ghost">
            Back to queue
          </Link>
        </div>
      </div>
    )
  }

  const { incident, candidate_teams: candidateTeams, nearby_incidents: nearby } = data
  const open = OPEN_STATUSES.has(incident.item.status) && !incident.merged_into_id
  const splittable = open && incident.reports.length > 1

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 text-sm sm:px-6">
      <IncidentHeader incident={incident} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <aside
          ref={actionsRef}
          aria-label="Actions"
          className="lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pb-1"
        >
          <ActionsPanel
            incident={incident}
            candidateTeams={candidateTeams}
            nearby={nearby}
            selectedReports={selectedReports}
            onClearSelection={() => setSelectedReports([])}
            mergeTarget={mergeTarget}
            onMergeTargetChange={setMergeTarget}
            actions={actions}
          />
        </aside>

        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <PriorityPanel incident={incident} />
          <ReportsList
            reports={incident.reports}
            selectable={splittable}
            selected={selectedReports}
            onToggle={(reportId) =>
              setSelectedReports((sel) =>
                sel.includes(reportId) ? sel.filter((r) => r !== reportId) : [...sel, reportId],
              )
            }
            onPhotoError={onPhotoError}
          />
          <IncidentMap
            incident={incident}
            nearby={nearby}
            mergeTarget={mergeTarget}
            canMerge={open}
            onSelectNearby={selectNearby}
          />
          <ActivityTimeline incident={incident} candidateTeams={candidateTeams} />
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  const bar = 'rounded bg-concrete-200 animate-pulse'
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading incident…
      </span>
      <div className={`${bar} h-4 w-28`} />
      <div className={`${bar} h-6 w-64`} />
      <div className={`${bar} h-9 w-80`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <div className={`${bar} h-40`} />
          <div className={`${bar} h-64`} />
        </div>
        <div className={`${bar} h-72 lg:col-start-2 lg:row-start-1`} />
      </div>
    </div>
  )
}
