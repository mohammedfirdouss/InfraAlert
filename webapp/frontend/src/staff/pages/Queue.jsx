/**
 * The dispatch queue: the dispatcher's home screen. A dense, priority-ordered
 * list of incidents (server order: priority plus a capped age bonus) beside a
 * map of the same incidents. Tab and issue-type filter live in the URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { List, Map as MapIcon, RefreshCw } from 'lucide-react'
import { ISSUE_TYPES } from '../ui.jsx'
import { filterApplies, formatClock, parseIssueType, parseTab } from '../queue/format.js'
import { useQueueData } from '../queue/useQueueData.js'
import QueueRow from '../queue/QueueRow.jsx'
import QueueMap from '../queue/QueueMap.jsx'
import QueueTabs, { PANEL_ID, tabId } from '../queue/QueueTabs.jsx'
import { QueueEmpty, QueueError, QueueSkeleton, StaleNotice } from '../queue/QueueStates.jsx'

const LIST_NAMES = {
  triage: 'Incidents needing triage',
  open: 'Open incidents, highest priority first',
  closed: 'Recently closed incidents, most recent first',
}

export default function Queue() {
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'))
  const issueType = parseIssueType(params.get('type'))
  const activeType = filterApplies(tab) ? issueType : null

  const { data, errors, lastUpdated, refreshing, refresh } = useQueueData(tab, issueType)
  const items = data[tab]
  const error = errors[tab]

  const [hoverId, setHoverId] = useState(/** @type {string | null} */ (null))
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null))
  const [view, setView] = useState(/** @type {'list' | 'map'} */ ('list'))
  const [scrollTarget, setScrollTarget] = useState(/** @type {{ id: string } | null} */ (null))
  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const onHover = useCallback((id) => setHoverId(id), [])
  const onLeave = useCallback(() => setHoverId(null), [])
  const onPinSelect = useCallback((id) => {
    setSelectedId(id)
    setView('list')
    setScrollTarget({ id })
  }, [])

  // Bring the row for a clicked pin into view (after a mobile view switch).
  useEffect(() => {
    if (!scrollTarget) return
    const rows = listRef.current?.querySelectorAll('[data-incident-id]') ?? []
    const row = Array.from(rows).find((el) => el.getAttribute('data-incident-id') === scrollTarget.id)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [scrollTarget])

  // Ages are shown to the minute; a minute-stable "now" keeps memoized rows still between refreshes.
  const now = lastUpdated ? Math.floor(lastUpdated.getTime() / 60000) * 60000 : Date.now()
  const counts = { triage: data.triage?.length, open: data.open?.length, closed: data.closed?.length }

  let content
  if (items === undefined) {
    content = error ? <QueueError error={error} retrying={refreshing} onRetry={refresh} /> : <QueueSkeleton />
  } else if (items.length === 0) {
    content = error ? (
      <QueueError error={error} retrying={refreshing} onRetry={refresh} />
    ) : (
      <QueueEmpty tab={tab} issueType={activeType} onClearFilter={() => setParam('type', null)} />
    )
  } else {
    content = (
      <>
        {error && <StaleNotice since={lastUpdated && formatClock(lastUpdated)} onRetry={refresh} />}
        <ul
          aria-label={LIST_NAMES[tab]}
          className="overflow-hidden rounded-lg border border-concrete-300 bg-white"
        >
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              now={now}
              onHover={onHover}
              onLeave={onLeave}
            />
          ))}
        </ul>
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Queue</h1>
          <p className="mt-0.5 text-[13px] text-asphalt-500">
            {lastUpdated ? (
              <>
                Last updated{' '}
                <time dateTime={lastUpdated.toISOString()} className="font-mono tabular-nums">
                  {formatClock(lastUpdated)}
                </time>
              </>
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={refresh}
          aria-label="Refresh the queue"
          aria-busy={refreshing}
        >
          <RefreshCw
            size={16}
            strokeWidth={2.5}
            aria-hidden="true"
            className={refreshing ? 'animate-spin' : ''}
          />
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <QueueTabs tab={tab} counts={counts} onChange={(t) => setParam('tab', t)} />
        {filterApplies(tab) && (
          <div className="flex items-center gap-2">
            <label htmlFor="queue-issue-type" className="text-[13px] font-bold">
              Issue type
            </label>
            <select
              id="queue-issue-type"
              value={issueType ?? ''}
              onChange={(e) => setParam('type', e.target.value || null)}
              className="min-h-[44px] rounded-md border-2 border-concrete-300 bg-white px-2 text-sm font-semibold hover:border-concrete-400 focus:border-ink"
            >
              <option value="">All types</option>
              {ISSUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div role="group" aria-label="Show" className="inline-flex self-start rounded-md border-2 border-ink lg:hidden">
        {[
          { value: 'list', label: 'List', Icon: List },
          { value: 'map', label: 'Map', Icon: MapIcon },
        ].map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 px-4 text-sm font-bold ${
              view === value ? 'bg-ink text-signal-300' : 'bg-white text-ink'
            }`}
          >
            <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:items-start lg:gap-4">
        <div
          ref={listRef}
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={tabId(tab)}
          data-testid="queue-list-pane"
          className={view === 'map' ? 'hidden lg:block' : ''}
        >
          {content}
        </div>
        <div
          data-testid="queue-map-pane"
          className={`h-[70vh] lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] ${view === 'list' ? 'hidden' : ''}`}
        >
          <QueueMap
            items={items}
            highlightedId={hoverId ?? selectedId}
            fitKey={`${tab}|${activeType ?? ''}`}
            view={view}
            onSelect={onPinSelect}
          />
        </div>
      </div>
    </div>
  )
}
