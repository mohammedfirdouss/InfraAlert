import { Check } from 'lucide-react'

/**
 * The normal path a report follows, in order. 'closed' is not on it: it is a
 * terminal state shown instead of the path.
 */
export const STATUS_STEPS = [
  { status: 'received', label: 'Received' },
  { status: 'under_review', label: 'Under review' },
  { status: 'team_assigned', label: 'Team assigned' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'resolved', label: 'Resolved' },
]

/** One-line hint shown under the current station. */
const STEP_HINTS = {
  received: 'Waiting for city staff to pick it up.',
  under_review: 'Staff are checking the details.',
  team_assigned: 'The work is being scheduled.',
  in_progress: 'A repair team is on the job.',
  resolved: 'Fixed. Thanks for reporting it.',
}

/**
 * The centre marking on a travelled stretch of road: yellow dashes running
 * down an asphalt bar (the vertical twin of the header's lane strip).
 */
const LANE_MARKING = {
  backgroundImage: 'repeating-linear-gradient(180deg, #ffd60a 0 8px, transparent 8px 14px)',
  backgroundSize: '2px 100%',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
}

/** A striped road barrier plank. Decorative. */
function Barrier() {
  return (
    <span
      aria-hidden="true"
      className="flex h-3.5 w-full overflow-hidden rounded-sm border-2 border-ink bg-white"
    >
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className={`-mx-px h-full flex-1 -skew-x-[35deg] ${i % 2 === 0 ? 'bg-ink' : 'bg-white'}`}
        />
      ))}
    </span>
  )
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * StatusTimeline: where a report is on its way to being fixed, drawn as a
 * route. Travelled stretches carry a lane marking; the road ahead is unpaved.
 *
 * @param {{ status: import('../api/client.js').ReportStatus }} props
 */
export default function StatusTimeline({ status }) {
  if (status === 'closed') {
    return (
      <ol aria-label="Report progress">
        <li
          aria-current="step"
          data-state="current"
          className="overflow-hidden rounded-lg border-2 border-ink bg-concrete-100"
        >
          <div className="px-4 pt-4">
            <Barrier />
          </div>
          <div className="flex flex-col gap-1 p-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-sign text-asphalt-500">
              Road closed
            </span>
            <span className="text-lg font-black leading-tight text-ink">Closed</span>
            <span className="text-sm text-asphalt-600">
              This report ended here, without repair work.
            </span>
            <span className="sr-only">(final status)</span>
          </div>
        </li>
      </ol>
    )
  }

  const currentIndex = Math.max(
    0,
    STATUS_STEPS.findIndex((step) => step.status === status),
  )

  return (
    <ol aria-label="Report progress">
      {STATUS_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
        const isLast = index === STATUS_STEPS.length - 1
        // The final step, once reached, is complete rather than in progress.
        const arrived = state === 'current' && step.status === 'resolved'

        let station
        if (arrived) {
          station = 'border-2 border-ink bg-go-500 text-white'
        } else if (state === 'done') {
          station = 'bg-ink text-signal-400'
        } else if (state === 'current') {
          station = 'border-2 border-ink bg-signal-400 animate-beacon'
        } else {
          station = 'border-2 border-concrete-300 bg-white'
        }

        return (
          <li
            key={step.status}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute left-4 top-9 bottom-1 w-2 -translate-x-1/2 rounded-full ${
                  state === 'done' ? 'bg-asphalt-800' : 'bg-concrete-300'
                }`}
                style={state === 'done' ? LANE_MARKING : undefined}
              />
            )}

            <span
              aria-hidden="true"
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${station}`}
            >
              {state === 'done' || arrived ? (
                <Check size={16} strokeWidth={3} />
              ) : state === 'current' ? (
                <span className="h-2.5 w-2.5 rounded-full bg-ink" />
              ) : null}
            </span>

            <span
              className={`flex min-h-8 min-w-0 flex-1 flex-col justify-center ${
                arrived ? '-my-1 rounded-lg bg-go-50 px-3 py-2' : ''
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={`font-mono text-[11px] ${
                    state === 'upcoming' ? 'text-concrete-400' : 'text-asphalt-400'
                  }`}
                >
                  {pad(index + 1)}
                </span>
                <span
                  className={
                    state === 'current'
                      ? `font-extrabold ${arrived ? 'text-go-700' : 'text-ink'}`
                      : state === 'done'
                        ? 'font-semibold text-asphalt-700'
                        : 'text-asphalt-400'
                  }
                >
                  {step.label}
                </span>
              </span>
              {state === 'current' && (
                <span className={`mt-0.5 text-sm ${arrived ? 'text-go-700' : 'text-asphalt-500'}`}>
                  {STEP_HINTS[step.status]}
                </span>
              )}
              <span className="sr-only">
                {state === 'done' ? '(completed)' : state === 'current' ? '(current step)' : '(upcoming)'}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
