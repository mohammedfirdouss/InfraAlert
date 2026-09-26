import { RefreshCw, TriangleAlert } from 'lucide-react'
import { issueTypeLabel } from './format.js'

/** Placeholder rows while a tab's first results load. */
export function QueueSkeleton() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-lg border border-concrete-300 bg-white">
      <span className="sr-only">Loading the queue…</span>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex gap-3 border-b border-concrete-200 px-4 py-3 last:border-b-0">
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <div className="h-5 w-20 animate-pulse rounded bg-concrete-200" />
              <div className="h-5 w-24 animate-pulse rounded bg-concrete-100" />
            </div>
            <div className="h-4 w-4/5 animate-pulse rounded bg-concrete-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-concrete-100" />
          </div>
          <div className="h-4 w-8 animate-pulse rounded bg-concrete-100" />
        </div>
      ))}
    </div>
  )
}

/**
 * Calm, per-tab empty state.
 * @param {{ tab: import('./format.js').QueueTab, issueType: string | null, onClearFilter: () => void }} props
 */
export function QueueEmpty({ tab, issueType, onClearFilter }) {
  const type = issueType ? issueTypeLabel(issueType).toLowerCase() : null
  const copy = {
    triage: {
      tag: 'ALL CLEAR',
      title: 'No reports waiting for triage',
      body: 'Every report has been classified. Reports the system can’t classify will appear here.',
    },
    open: {
      tag: 'ALL CLEAR',
      title: type ? `No open ${type} incidents` : 'Queue clear',
      body: 'No incidents are waiting for a team. New ones appear here automatically.',
    },
    closed: {
      tag: 'NOTHING RECENT',
      title: type ? `No ${type} incidents closed recently` : 'Nothing closed recently',
      body: 'Incidents resolved or closed in the last few days are listed here.',
    },
  }[tab]
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-concrete-300 bg-white px-6 py-14 text-center">
      <span className="readout tracking-sign">{copy.tag}</span>
      <h2 className="text-lg font-extrabold">{copy.title}</h2>
      <p className="max-w-sm text-sm text-asphalt-500">{copy.body}</p>
      {type && (
        <button type="button" className="btn-ghost" onClick={onClearFilter}>
          Show all issue types
        </button>
      )}
    </div>
  )
}

/** @param {unknown} error */
function errorMessage(error) {
  const status = /** @type {{ status?: number }} */ (error)?.status
  if (status === 403) return 'You don’t have access to the dispatch queue.'
  return 'Couldn’t load the queue. Check your connection, then try again.'
}

/**
 * Hazard panel for a failed first load.
 * @param {{ error: unknown, retrying: boolean, onRetry: () => void }} props
 */
export function QueueError({ error, retrying, onRetry }) {
  const status = /** @type {{ status?: number }} */ (error)?.status
  return (
    <div role="alert" className="overflow-hidden rounded-lg border-2 border-hazard-500 bg-hazard-50">
      <div aria-hidden="true" className="hazard-edge h-2" />
      <div className="flex flex-col items-start gap-3 p-5">
        <p className="flex items-center gap-2 font-bold text-hazard-700">
          <TriangleAlert size={18} strokeWidth={2.5} aria-hidden="true" />
          {errorMessage(error)}
        </p>
        {status != null && <span className="font-mono text-xs text-asphalt-500">HTTP {status}</span>}
        <button type="button" className="btn-secondary" onClick={onRetry} disabled={retrying}>
          <RefreshCw size={16} strokeWidth={2.5} aria-hidden="true" className={retrying ? 'animate-spin' : ''} />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}

/**
 * A refresh failed but older results are still on screen.
 * @param {{ since: string | null, onRetry: () => void }} props
 */
export function StaleNotice({ since, onRetry }) {
  return (
    <div role="status" className="mb-2 flex items-center justify-between gap-3 rounded-md border border-hazard-500 bg-hazard-50 px-3 py-1.5 text-[13px] font-semibold text-hazard-700">
      <span>Couldn’t refresh.{since ? ` Showing the list from ${since}.` : ''}</span>
      <button type="button" className="font-bold text-ink underline underline-offset-2" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
