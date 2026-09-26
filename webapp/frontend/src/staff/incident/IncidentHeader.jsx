import { ArrowLeft, GitMerge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HazardFlags, IssueTypeLabel, SeverityBadge, StatusPill, formatAge, formatDateTime } from '../ui.jsx'
import { shortRef } from './format.js'

/**
 * Who, what, how urgent: the incident's identity at a glance.
 * @param {{ incident: import('../api.js').IncidentDetail }} props
 */
export default function IncidentHeader({ incident }) {
  const { item } = incident
  return (
    <header className="space-y-3">
      <Link to="/staff" className="btn-ghost -ml-3 text-sm">
        <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
        Back to queue
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span className="readout" title="Reference">{shortRef(item.id)}</span>
        <SeverityBadge severity={item.severity} score={item.priority_score} />
        <StatusPill status={item.status} />
        <HazardFlags flags={item.hazard_flags} />
      </div>

      <h1 className="text-2xl font-black leading-tight sm:text-3xl">
        <IssueTypeLabel value={item.issue_type} className="[&>svg]:h-6 [&>svg]:w-6" />
      </h1>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-asphalt-600">
        <div className="flex gap-1.5">
          <dt className="font-bold text-ink">Opened</dt>
          <dd>
            <time dateTime={item.created_at}>{formatAge(item.created_at)} ago</time>
            <span className="text-asphalt-400"> · {formatDateTime(item.created_at)}</span>
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-bold text-ink">Reports</dt>
          <dd className="font-mono">{item.report_count}</dd>
        </div>
        {item.assigned_team ? (
          <div className="flex gap-1.5">
            <dt className="font-bold text-ink">Assigned</dt>
            <dd>{item.assigned_team.name}</dd>
          </div>
        ) : item.suggested_team ? (
          <div className="flex gap-1.5">
            <dt className="font-bold text-ink">Suggested team</dt>
            <dd>{item.suggested_team.name}</dd>
          </div>
        ) : null}
        {item.address_text && (
          <div className="flex gap-1.5">
            <dt className="font-bold text-ink">Near</dt>
            <dd>{item.address_text}</dd>
          </div>
        )}
      </dl>

      {incident.merged_into_id && (
        <p className="flex items-center gap-2 rounded-lg border-2 border-ink bg-concrete-100 px-3 py-2 text-sm font-semibold">
          <GitMerge size={16} strokeWidth={2.5} aria-hidden="true" />
          Merged into{' '}
          <Link to={`/staff/incidents/${incident.merged_into_id}`} className="font-mono underline decoration-2 underline-offset-4">
            {shortRef(incident.merged_into_id)}
          </Link>
          . Its reports now live there.
        </p>
      )}
    </header>
  )
}
