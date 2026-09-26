import { useState } from 'react'
import { IssueTypeLabel, StatusPill, formatDistance } from '../ui.jsx'
import { parseIncidentId, shortRef } from './format.js'
import { ActionError, useAction } from './Plate.jsx'

/**
 * Merge this incident into another (ADR 0006): pick a nearby one (here or on the
 * map) or paste an id, then confirm inline.
 *
 * @param {{
 *   incidentId: string, reportCount: number, teamName: string | null,
 *   nearby: import('../api.js').NearbyIncident[],
 *   target: string | null, onTargetChange: (id: string | null) => void,
 *   onMerge: (intoId: string) => Promise<{ ok: boolean, message?: string }>,
 * }} props
 */
export default function MergeAction({ incidentId, reportCount, teamName, nearby, target, onTargetChange, onMerge }) {
  const [open, setOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState(/** @type {string | null} */ (null))
  const { run, pending, error } = useAction(onMerge)
  const showing = open || Boolean(target)
  const reference = shortRef(incidentId)

  if (!showing) {
    return (
      <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
        Merge into another incident…
      </button>
    )
  }

  const cancel = () => {
    setOpen(false)
    setPasted('')
    setPasteError(null)
    onTargetChange(null)
  }

  const applyPasted = () => {
    const id = parseIncidentId(pasted, nearby)
    if (!id) {
      setPasteError('Paste the full incident ID, or the INC reference of one listed above.')
      return
    }
    if (id === incidentId) {
      setPasteError("That's this incident. Pick a different one.")
      return
    }
    setPasteError(null)
    onTargetChange(id)
  }

  const reports = `${reportCount} report${reportCount === 1 ? '' : 's'}`

  return (
    <div className="space-y-3 rounded-lg border-2 border-ink bg-concrete-50 p-3">
      <fieldset>
        <legend className="label">Merge {reference} into</legend>
        {nearby.length === 0 ? (
          <p className="text-sm text-asphalt-600">No other open incidents within 150 m.</p>
        ) : (
          <ul className="divide-y divide-concrete-200 rounded-md border border-concrete-300 bg-white">
            {nearby.map((n) => (
              <li key={n.id}>
                <label className="flex min-h-[44px] cursor-pointer items-start gap-2 px-2 py-2 text-sm">
                  <input
                    type="radio"
                    name="merge-target"
                    value={n.id}
                    checked={target === n.id}
                    onChange={() => onTargetChange(n.id)}
                    className="mt-1 h-4 w-4 accent-ink"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs font-semibold">{shortRef(n.id)}</span>
                      <IssueTypeLabel value={n.issue_type} className="font-semibold" />
                      <StatusPill status={n.status} />
                    </span>
                    <span className="mt-0.5 block truncate text-asphalt-600">{n.headline}</span>
                    <span className="font-mono text-xs text-asphalt-500">
                      {formatDistance(n.distance_m)} away · {n.report_count} report{n.report_count === 1 ? '' : 's'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div>
        <label htmlFor="merge-paste" className="label">
          Or paste an incident ID
        </label>
        <div className="flex gap-2">
          <input
            id="merge-paste"
            className="input font-mono"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-invalid={pasteError ? 'true' : undefined}
            aria-describedby={pasteError ? 'merge-paste-error' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyPasted()
              }
            }}
          />
          <button type="button" className="btn-secondary" onClick={applyPasted} disabled={!pasted.trim()}>
            Use
          </button>
        </div>
        {pasteError && (
          <p id="merge-paste-error" className="field-error">
            {pasteError}
          </p>
        )}
      </div>

      {target && (
        <div className="space-y-2 rounded-md border-2 border-ink bg-white p-2" role="group" aria-label="Confirm merge">
          <p className="text-sm font-bold" id="merge-confirm">
            Merge {reference} into {shortRef(target)}? Its {reports} move to {shortRef(target)}, and {reference} closes
            as a duplicate.{teamName && ` ${teamName} will be released.`} Citizens will follow {shortRef(target)}&rsquo;s
            progress.
          </p>
          <ActionError message={error} />
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={pending}
            aria-describedby="merge-confirm"
            onClick={() => run(target)}
          >
            {pending ? 'Merging…' : `Merge into ${shortRef(target)}`}
          </button>
        </div>
      )}
      <button type="button" className="btn-ghost" onClick={cancel}>
        Cancel
      </button>
    </div>
  )
}
