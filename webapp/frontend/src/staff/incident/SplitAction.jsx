import { useState } from 'react'
import { issueTypeName, shortRef } from './format.js'
import { ActionError, useAction } from './Plate.jsx'

/**
 * Move the reports ticked in the reports list into a new incident (ADR 0006).
 * @param {{
 *   incidentId: string, issueType: string | null, reportCount: number, selected: string[],
 *   onClear: () => void, onSplit: (ids: string[]) => Promise<{ ok: boolean, message?: string }>,
 * }} props
 */
export default function SplitAction({ incidentId, issueType, reportCount, selected, onClear, onSplit }) {
  const [confirming, setConfirming] = useState(false)
  const { run, pending, error } = useAction(onSplit)
  const n = selected.length
  const all = n === reportCount
  const reports = `${n} report${n === 1 ? '' : 's'}`

  if (n === 0) {
    return (
      <p className="text-[13px] text-asphalt-600">
        Wrongly grouped? Tick reports in the list below to move them to a new incident.
      </p>
    )
  }
  if (all) {
    return (
      <p className="text-[13px] font-semibold text-asphalt-600">
        All reports are ticked. Leave at least one here; to move them all, merge instead.
      </p>
    )
  }
  if (!confirming) {
    return (
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => setConfirming(true)}>
          Move {reports} to a new incident
        </button>
        <button type="button" className="btn-ghost" onClick={onClear}>
          Clear
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border-2 border-ink bg-concrete-50 p-3" role="group" aria-label="Confirm split">
      <p className="text-sm font-bold" id="split-confirm">
        Move {reports} out of {shortRef(incidentId)} into a new incident?
        {issueType ? ` It starts as ${issueTypeName(issueType)}, ` : ' It starts unclassified, '}
        unassigned, and both incidents are scored again.
      </p>
      <ActionError message={error} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={pending}
          aria-describedby="split-confirm"
          onClick={() => run(selected)}
        >
          {pending ? 'Moving…' : `Yes, move ${reports}`}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
