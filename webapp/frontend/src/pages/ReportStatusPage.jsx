import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  AlertCircle,
  Bookmark,
  Calendar,
  Camera,
  CheckCircle2,
  Copy,
  MapPin,
  RefreshCw,
  Tag,
} from 'lucide-react'
import { getReport } from '../api/client.js'
import StatusTimeline from '../components/StatusTimeline.jsx'
import LocationPreview from '../components/LocationPreview.jsx'

/** How often an open report is re-fetched while the page is visible. */
export const POLL_INTERVAL_MS = 30_000

/** Statuses after which nothing changes, so polling stops. */
const FINAL_STATUSES = new Set(['resolved', 'closed'])

/** Citizen-facing names for the issue-type enum. */
export const ISSUE_TYPE_LABELS = {
  pothole: 'Pothole',
  water_leak: 'Water leak',
  power_outage: 'Power outage',
  broken_streetlight: 'Broken streetlight',
  sewage: 'Sewage problem',
  road_damage: 'Road damage',
  other: 'Other problem',
}

/** Plain-language explanation of each status. Never mentions staff-only detail. */
export const STATUS_EXPLANATIONS = {
  received: "We've received your report. It's waiting for city staff to look at it.",
  under_review: 'City staff are reviewing your report.',
  team_assigned: 'A repair team has been assigned and will schedule the work.',
  in_progress: 'A repair team is working on the problem now.',
  resolved: 'The problem has been fixed. Thank you for reporting it!',
  closed:
    "This report was closed without repair work, for example because it was a duplicate of a problem that was already handled, or because it couldn't be verified.",
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** @param {string} iso */
export function formatSubmittedAt(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date)
}

/** @param {unknown} err */
function isNotFound(err) {
  return err?.name === 'ApiError' && (err.status === 404 || err.status === 422)
}

/**
 * @typedef {{ phase: 'loading' }
 *   | { phase: 'loaded', report: import('../api/client.js').Report }
 *   | { phase: 'not_found' }
 *   | { phase: 'error' }} LoadState
 */

/**
 * Loads a report and keeps it fresh: polls every POLL_INTERVAL_MS until the
 * status is final, pauses while the tab is hidden and refreshes on return.
 * Responses for a previous id or after unmount are ignored.
 *
 * @param {string} id
 * @returns {{ state: LoadState, retry: () => void }}
 */
function useReport(id) {
  const [state, setState] = useState(/** @type {LoadState} */ ({ phase: 'loading' }))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let timer = null
    let inFlight = false
    // Polling only runs once a report has loaded and while it isn't final.
    let polling = false

    setState({ phase: 'loading' })

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    const schedule = () => {
      clearTimer()
      if (polling && document.visibilityState !== 'hidden') {
        timer = setTimeout(load, POLL_INTERVAL_MS)
      }
    }

    async function load() {
      timer = null
      inFlight = true
      try {
        const report = await getReport(id)
        if (!active) return
        polling = !FINAL_STATUSES.has(report.status)
        setState({ phase: 'loaded', report })
      } catch (err) {
        if (!active) return
        if (isNotFound(err)) {
          polling = false
          setState({ phase: 'not_found' })
        } else if (!polling) {
          // First load failed: show the error with a Retry button.
          setState({ phase: 'error' })
        }
        // A failed background refresh keeps showing the last good report.
      } finally {
        inFlight = false
        if (active) schedule()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer()
      } else if (polling && !inFlight) {
        clearTimer()
        load()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    load()

    return () => {
      active = false
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [id, attempt])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

/** Banner shown right after submitting: the link is the citizen's only way back. */
function JustSubmittedBanner() {
  const [copy, setCopy] = useState(/** @type {'idle' | 'copied' | 'failed'} */ ('idle'))
  const url = window.location.href

  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <section
      aria-labelledby="submitted-heading"
      className="rounded-xl border border-success-500 bg-success-50 p-4"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="submitted-heading" className="font-semibold text-gray-900">
            Your report has been sent
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            Save this page&apos;s link: it&apos;s the only way to follow your report&apos;s
            progress. Bookmark it or copy it somewhere safe.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              readOnly
              value={url}
              aria-label="Link to this report"
              onFocus={(e) => e.target.select()}
              className="input min-w-0 flex-1 font-mono text-xs"
            />
            <button type="button" className="btn-primary shrink-0" onClick={copyLink}>
              {copy === 'copied' ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copy === 'copied' ? 'Link copied' : 'Copy link'}
            </button>
          </div>
          <p role="status" className="mt-2 text-sm">
            {copy === 'copied' && <span className="text-success-600">Link copied to your clipboard.</span>}
            {copy === 'failed' && (
              <span className="text-danger-600">
                Couldn&apos;t copy automatically. Please copy the link above or bookmark this page.
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading report" className="space-y-4 animate-pulse">
      <div className="h-7 w-48 rounded bg-gray-200" />
      <div className="card p-6 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-5 w-40 rounded bg-gray-200" />
        ))}
      </div>
      <div className="card p-6 space-y-3">
        <div className="h-4 w-full rounded bg-gray-200" />
        <div className="h-4 w-2/3 rounded bg-gray-200" />
        <div className="h-48 w-full rounded-lg bg-gray-200" />
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="card p-8 text-center">
      <AlertCircle size={32} className="mx-auto text-gray-400" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-bold text-gray-900">We couldn&apos;t find this report</h1>
      <p className="mt-2 text-sm text-gray-600">
        Check that you have the complete link. If the problem is still there, you can report it
        again.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Report a new issue
      </Link>
    </div>
  )
}

/** @param {{ onRetry: () => void }} props */
function LoadError({ onRetry }) {
  return (
    <div role="alert" className="card p-8 text-center">
      <AlertCircle size={32} className="mx-auto text-danger-500" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-bold text-gray-900">We couldn&apos;t load this report</h1>
      <p className="mt-2 text-sm text-gray-600">
        Something went wrong on our side or with your connection. Please try again.
      </p>
      <button type="button" className="btn-secondary mt-6" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" />
        Retry
      </button>
    </div>
  )
}

/** @param {{ icon: import('react').ComponentType<any>, label: string, children: import('react').ReactNode }} props */
function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
        <dd className="text-sm text-gray-900 break-words">{children}</dd>
      </div>
    </div>
  )
}

/** @param {{ report: import('../api/client.js').Report }} props */
function ReportView({ report }) {
  const { lat, lng } = report.location
  const issueLabel =
    report.issue_type == null
      ? 'Being classified'
      : (ISSUE_TYPE_LABELS[report.issue_type] ?? ISSUE_TYPE_LABELS.other)
  const photos =
    report.photo_count === 0
      ? 'No photos attached'
      : `${report.photo_count} ${report.photo_count === 1 ? 'photo' : 'photos'} attached`

  return (
    <>
      <section aria-labelledby="progress-heading" className="card p-6">
        <h2 id="progress-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Progress
        </h2>
        <p className="mt-2 text-gray-900" data-testid="status-explanation">
          {STATUS_EXPLANATIONS[report.status] ?? ''}
        </p>
        <div className="mt-5">
          <StatusTimeline status={report.status} />
        </div>
      </section>

      <section aria-labelledby="details-heading" className="card p-6">
        <h2 id="details-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Your report
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-gray-900">{report.description}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Detail icon={Tag} label="Type of problem">
            {issueLabel}
          </Detail>
          <Detail icon={Calendar} label="Submitted">
            <time dateTime={report.submitted_at}>{formatSubmittedAt(report.submitted_at)}</time>
          </Detail>
          <Detail icon={MapPin} label="Location">
            {report.address_text || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
          </Detail>
          <Detail icon={Camera} label="Photos">
            {photos}
          </Detail>
        </dl>
        <div className="mt-5">
          <LocationPreview location={report.location} />
        </div>
      </section>
    </>
  )
}

/** ReportStatusPage: the citizen's status link at "/reports/:id". */
export default function ReportStatusPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const justSubmitted = Boolean(location.state?.justSubmitted)
  const { state, retry } = useReport(id)

  let body
  if (state.phase === 'loading') body = <LoadingSkeleton />
  else if (state.phase === 'not_found') body = <NotFound />
  else if (state.phase === 'error') body = <LoadError onRetry={retry} />
  else
    body = (
      <>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Report status</h1>
          <p className="mt-1 text-xs text-gray-500">
            Reference: <span className="font-mono">{state.report.report_id}</span>
          </p>
        </div>
        <ReportView report={state.report} />
        {!justSubmitted && (
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <Bookmark size={14} aria-hidden="true" />
            Bookmark this page to check on your report later.
          </p>
        )}
      </>
    )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {justSubmitted && <JustSubmittedBanner />}
      {body}
    </div>
  )
}
