import { useRef } from 'react'
import { QUEUE_TABS, TAB_LABELS } from './format.js'

export const tabId = (tab) => `queue-tab-${tab}`
export const PANEL_ID = 'queue-panel'

/**
 * @param {{ tab: import('./format.js').QueueTab, count: number | undefined }} props
 */
function CountBadge({ tab, count }) {
  if (count == null) return null
  const waiting = tab === 'triage' && count > 0
  return (
    <span
      data-testid={`count-${tab}`}
      className={`min-w-[1.5rem] rounded px-1.5 py-0.5 text-center font-mono text-xs font-semibold tabular-nums ${
        waiting ? 'bg-hazard-500 text-white' : 'bg-concrete-200 text-asphalt-600'
      }`}
    >
      {count}
    </span>
  )
}

/**
 * An ARIA tablist (arrow keys, Home/End) with a live count on each tab.
 * @param {{
 *   tab: import('./format.js').QueueTab,
 *   counts: Record<string, number | undefined>,
 *   onChange: (tab: import('./format.js').QueueTab) => void,
 * }} props
 */
export default function QueueTabs({ tab, counts, onChange }) {
  const refs = useRef({})
  const move = (to) => {
    onChange(to)
    refs.current[to]?.focus()
  }
  const onKeyDown = (event) => {
    const i = QUEUE_TABS.indexOf(tab)
    const n = QUEUE_TABS.length
    const target = {
      ArrowRight: QUEUE_TABS[(i + 1) % n],
      ArrowLeft: QUEUE_TABS[(i - 1 + n) % n],
      Home: QUEUE_TABS[0],
      End: QUEUE_TABS[n - 1],
    }[event.key]
    if (!target) return
    event.preventDefault()
    move(target)
  }
  return (
    <div role="tablist" aria-label="Queue" className="flex gap-1 border-b-2 border-concrete-200" onKeyDown={onKeyDown}>
      {QUEUE_TABS.map((t) => {
        const selected = t === tab
        return (
          <button
            key={t}
            ref={(el) => (refs.current[t] = el)}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={selected}
            aria-controls={PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t)}
            className={`-mb-0.5 inline-flex min-h-[44px] items-center gap-2 border-b-4 px-3 text-sm font-bold ${
              selected ? 'border-signal-400 text-ink' : 'border-transparent text-asphalt-500 hover:text-ink'
            }`}
          >
            {TAB_LABELS[t]}
            <CountBadge tab={t} count={counts[t]} />
          </button>
        )
      })}
    </div>
  )
}
