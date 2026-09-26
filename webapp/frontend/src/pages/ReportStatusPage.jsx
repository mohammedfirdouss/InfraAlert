import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  ArrowRight,
  Bookmark,
  Check,
  CircleDashed,
  CircleHelp,
  Construction,
  Copy,
  Droplets,
  Lightbulb,
  RefreshCw,
  TriangleAlert,
  Waves,
  Zap,
} from 'lucide-react'
import { getReport } from '../api/client.js'
import StatusTimeline, { STATUS_STEPS } from '../components/StatusTimeline.jsx'
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

/** Shared lucide sizing: 18px with a slightly heavier stroke, to sit with Overpass. */
const ICON = { size: 18, strokeWidth: 2.25, 'aria-hidden': true }

/** Icon for each issue type, shown beside its label. */
const ISSUE_TYPE_ICONS = {
  pothole: Construction,
  water_leak: Droplets,
  power_outage: Zap,
  broken_streetlight: Lightbulb,
  sewage: Waves,
  road_damage: TriangleAlert,
  other: CircleHelp,
}

/** Big headline word for each status. */
const STATUS_HEADLINES = {
  ...Object.fromEntries(STATUS_STEPS.map((step) => [step.status, step.label])),
  closed: 'Closed',
}

/** Half-circle bite taken out of the ticket's side at the perforation. */
function Notch({ side }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-1/2 h-7 w-3.5 -translate-y-1/2 border-2 border-ink bg-concrete-50 ${
        side === 'left'
          ? '-left-0.5 rounded-r-full border-l-0'
          : '-right-0.5 rounded-l-full border-r-0'
      }`}
    />
  )
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
      className="relative animate-rise-in rounded-xl border-2 border-ink bg-white shadow-plate"
    >
      <div className="flex items-start gap-4 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-go-500 text-white ring-4 ring-go-100">
          <Check size={24} strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="submitted-heading" className="text-2xl font-black leading-tight">
            Report sent
          </h2>
          <p className="mt-1 text-[15px] leading-snug text-asphalt-600">
            Save this page&apos;s link: it&apos;s the{' '}
            <strong className="font-bold text-ink">only way to follow your report&apos;s progress</strong>. Bookmark it or copy it somewhere safe.
          </p>
        </div>
      </div>

      {/* Perforation: a dashed tear line with notches cut from both sides. */}
      <div aria-hidden="true" className="relative h-0">
        <Notch side="left" />
        <div className="mx-5 border-t-2 border-dashed border-concrete-400" />
        <Notch side="right" />
      </div>

      <div className="p-5">
        <p aria-hidden="true" className="section-no mb-2 uppercase tracking-sign">
          Your link · keep it
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            type="text"
            readOnly
            value={url}
            aria-label="Link to this report"
            onFocus={(e) => e.target.select()}
            className="input min-w-0 flex-1 bg-concrete-50 font-mono text-sm"
          />
          <button
            type="button"
            className={`${copy === 'copied' ? 'btn-secondary' : 'btn-primary'} shrink-0 sm:w-36`}
            onClick={copyLink}
          >
            {copy === 'copied' ? (
              <Check {...ICON} strokeWidth={3} className="text-go-600" />
            ) : (
              <Copy {...ICON} />
            )}
            {copy === 'copied' ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <p role="status" className="mt-2 min-h-5 text-sm font-semibold empty:mt-0 empty:min-h-0">
          {copy === 'copied' && <span className="text-go-700">Link copied to your clipboard.</span>}
          {copy === 'failed' && (
            <span className="text-hazard-700">
              Couldn&apos;t copy automatically. Please copy the link above or bookmark this page.
            </span>
          )}
        </p>
      </div>
    </section>
  )
}

/** @param {{ className?: string }} props */
function Bone({ className = '' }) {
  return <div className={`rounded bg-concrete-200 ${className}`} />
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading report" className="animate-pulse space-y-6">
      <div className="space-y-3">
        <Bone className="h-5 w-28" />
        <Bone className="h-10 w-56" />
        <Bone className="h-4 w-full max-w-md" />
        <Bone className="h-4 w-2/3 max-w-xs" />
      </div>
      <div className="card space-y-6 p-5 sm:p-6">
        <Bone className="h-3 w-24" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-concrete-200" />
            <Bone className="h-4 w-32" />
          </div>
        ))}
      </div>
      <div className="card space-y-4 p-5 sm:p-6">
        <Bone className="h-3 w-28" />
        <Bone className="h-16 w-full" />
        {[0, 1, 2].map((i) => (
          <Bone key={i} className="h-4 w-3/4" />
        ))}
        <div className="h-56 w-full rounded-xl bg-concrete-200" />
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="animate-rise-in py-12 text-center">
      <p className="font-mono text-sm text-asphalt-400">404 · ROAD CLOSED</p>
      <h1 className="mt-3 text-3xl font-black">We couldn&apos;t find this report</h1>
      <p className="mx-auto mt-2 max-w-md text-asphalt-500">
        Check that you have the complete link. If the problem is still there, you can report it
        again.
      </p>
      <Link to="/" className="btn-primary mt-8">
        Report a new issue
        <ArrowRight {...ICON} />
      </Link>
    </div>
  )
}

/** @param {{ onRetry: () => void }} props */
function LoadError({ onRetry }) {
  return (
    <div
      role="alert"
      className="animate-rise-in rounded-xl border-2 border-hazard-500 bg-hazard-50 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert {...ICON} size={22} className="mt-1 shrink-0 text-hazard-600" />
        <div className="min-w-0">
          <h1 className="text-xl font-black">We couldn&apos;t load this report</h1>
          <p className="mt-1 text-asphalt-600">
            Something went wrong on our side or with your connection. Please try again.
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
            <RefreshCw {...ICON} />
            Retry
          </button>
        </div>
      </div>
    </div>
  )
}

/** Card heading in the field-report voice: "01  PROGRESS". */
function SectionHeading({ id, no, children }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2.5">
      <span className="section-no" aria-hidden="true">
        {no}
      </span>
      <span className="section-title">{children}</span>
    </h2>
  )
}

/** @param {{ label: string, children: import('react').ReactNode }} props */
function Detail({ label, children }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 border-t border-concrete-200 py-3 first:border-t-0 first:pt-0">
      <dt className="pt-0.5 text-[11px] font-bold uppercase tracking-sign text-asphalt-500">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[15px] text-ink">{children}</dd>
    </div>
  )
}

/** @param {{ issueType: string | null }} props */
function IssueType({ issueType }) {
  if (issueType == null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border-2 border-dashed border-concrete-400 bg-concrete-50 px-2 py-0.5 text-sm font-semibold text-asphalt-600">
        <CircleDashed {...ICON} size={14} className="animate-spin [animation-duration:3s]" />
        Being classified
      </span>
    )
  }
  const known = issueType in ISSUE_TYPE_LABELS
  const Icon = ISSUE_TYPE_ICONS[known ? issueType : 'other']
  return (
    <span className="inline-flex items-center gap-2 font-bold">
      <Icon {...ICON} className="shrink-0 text-asphalt-600" />
      {ISSUE_TYPE_LABELS[known ? issueType : 'other']}
    </span>
  )
}

/** @param {{ report: import('../api/client.js').Report }} props */
function StatusHero({ report }) {
  const live = !FINAL_STATUSES.has(report.status)
  const shortRef = report.report_id.replace(/-/g, '').slice(0, 8).toUpperCase()
  const tone =
    report.status === 'resolved'
      ? 'text-go-700'
      : report.status === 'closed'
        ? 'text-asphalt-600'
        : 'text-ink'

  return (
    <header className="animate-rise-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="tag">Report status</h1>
        <p className="readout" title={report.report_id}>
          <span aria-hidden="true">REF {shortRef}</span>
          <span className="sr-only">Reference: {report.report_id}</span>
        </p>
      </div>
      <p className={`mt-4 text-4xl font-black leading-none tracking-tight sm:text-5xl ${tone}`}>
        {STATUS_HEADLINES[report.status] ?? 'Received'}
      </p>
      <p className="mt-3 max-w-prose text-lg leading-snug text-asphalt-600" data-testid="status-explanation">
        {STATUS_EXPLANATIONS[report.status] ?? ''}
      </p>
      {live && (
        <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-asphalt-500">
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-beacon rounded-full border-2 border-ink bg-signal-400"
          />
          Updates automatically
        </p>
      )}
    </header>
  )
}

/** @param {{ report: import('../api/client.js').Report }} props */
function ReportView({ report }) {
  const { lat, lng } = report.location
  const coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  const photos =
    report.photo_count === 0
      ? 'No photos attached'
      : `${report.photo_count} ${report.photo_count === 1 ? 'photo' : 'photos'} attached`

  return (
    <>
      <StatusHero report={report} />

      <section aria-labelledby="progress-heading" className="card p-5 sm:p-6">
        <SectionHeading id="progress-heading" no="01">
          Progress
        </SectionHeading>
        <div className="mt-5">
          <StatusTimeline status={report.status} />
        </div>
      </section>

      <section aria-labelledby="details-heading" className="card p-5 sm:p-6">
        <SectionHeading id="details-heading" no="02">
          Your report
        </SectionHeading>
        <blockquote className="mt-4 border-l-4 border-ink py-1 pl-4">
          <p className="whitespace-pre-wrap text-lg leading-snug text-ink">{report.description}</p>
        </blockquote>
        <dl className="mt-6">
          <Detail label="Type">
            <IssueType issueType={report.issue_type} />
          </Detail>
          <Detail label="Submitted">
            <time dateTime={report.submitted_at}>{formatSubmittedAt(report.submitted_at)}</time>
          </Detail>
          <Detail label="Location">
            {report.address_text ? (
              <>
                <span className="block">{report.address_text}</span>
                <span className="mt-0.5 block font-mono text-[13px] text-asphalt-500">{coords}</span>
              </>
            ) : (
              <span className="font-mono text-sm">{coords}</span>
            )}
          </Detail>
          <Detail label="Photos">{photos}</Detail>
        </dl>
        <div className="mt-4">
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
        <ReportView report={state.report} />
        {!justSubmitted && (
          <p className="flex items-center gap-2 text-[13px] text-asphalt-500">
            <Bookmark {...ICON} size={16} className="shrink-0" />
            Bookmark this page to check on your report later.
          </p>
        )}
      </>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:py-10">
      {justSubmitted && <JustSubmittedBanner />}
      {body}
    </div>
  )
}
