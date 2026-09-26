import { memo } from 'react'
import { Link } from 'react-router-dom'
import { HazardFlags, IssueTypeLabel, SeverityBadge, StatusPill, formatAge, formatDateTime } from '../ui.jsx'
import { describeItem, formatPlace, formatReportCount, hasLifeSafetyHazard } from './format.js'

/**
 * The team an incident has: assigned (a human decision, solid) or only
 * suggested by the system (dashed, per DESIGN.md).
 * @param {{ item: import('../api.js').QueueItem }} props
 */
function TeamChip({ item }) {
  if (item.assigned_team) {
    return (
      <span className="inline-block max-w-[11rem] truncate align-middle rounded border-2 border-ink bg-white px-1.5 py-0.5 text-xs font-bold">
        {item.assigned_team.name}
      </span>
    )
  }
  if (item.suggested_team) {
    return (
      <span className="inline-block max-w-[11rem] truncate align-middle rounded border border-dashed border-asphalt-400 px-1.5 py-0.5 text-xs text-asphalt-600">
        Suggested: {item.suggested_team.name}
      </span>
    )
  }
  return null
}

/**
 * One queue row: a link to the incident, urgency first. Memoized: it only
 * re-renders when its item (kept stable across refreshes), selection or the
 * minute-rounded `now` changes.
 *
 * @param {{
 *   item: import('../api.js').QueueItem,
 *   selected: boolean,
 *   now: number,
 *   onHover: (id: string) => void,
 *   onLeave: () => void,
 * }} props
 */
function QueueRow({ item, selected, now, onHover, onLeave }) {
  const lifeSafety = hasLifeSafetyHazard(item)
  const place = formatPlace(item)
  return (
    <li data-incident-id={item.id} className="border-b border-concrete-200 last:border-b-0">
      <Link
        to={`/staff/incidents/${encodeURIComponent(item.id)}`}
        aria-label={describeItem(item, now)}
        data-selected={selected || undefined}
        onMouseEnter={() => onHover(item.id)}
        onMouseLeave={onLeave}
        onFocus={() => onHover(item.id)}
        onBlur={onLeave}
        className={`flex gap-3 border-l-4 py-2.5 pl-3 pr-3 text-sm transition-colors focus-visible:rounded-none ${
          lifeSafety ? 'border-l-hazard-500' : 'border-l-transparent'
        } ${selected ? 'bg-signal-100' : 'hover:bg-concrete-100 focus-visible:bg-concrete-100'}`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={item.severity} score={item.priority_score} />
            <HazardFlags flags={item.hazard_flags} />
            <IssueTypeLabel value={item.issue_type} className="text-[13px] font-semibold" />
          </div>
          <p className="line-clamp-2 font-semibold leading-snug text-ink">{item.headline}</p>
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-asphalt-500">
            <span className={`truncate ${item.address_text ? '' : 'font-mono text-xs'}`}>{place}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {formatReportCount(item.report_count)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <time
            dateTime={item.created_at}
            title={formatDateTime(item.created_at)}
            className="font-mono text-xs font-semibold tabular-nums text-asphalt-600"
          >
            {formatAge(item.created_at, now)}
          </time>
          <StatusPill status={item.status} />
          <TeamChip item={item} />
        </div>
      </Link>
    </li>
  )
}

export default memo(QueueRow)
