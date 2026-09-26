import { Check, XCircle } from 'lucide-react'

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

/**
 * StatusTimeline: where a report is on its way to being fixed.
 *
 * @param {{ status: import('../api/client.js').ReportStatus }} props
 */
export default function StatusTimeline({ status }) {
  if (status === 'closed') {
    return (
      <ol aria-label="Report progress" className="space-y-3">
        <li aria-current="step" data-state="current" className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-600 text-white">
            <XCircle size={18} aria-hidden="true" />
          </span>
          <span className="font-semibold text-gray-900">Closed</span>
        </li>
      </ol>
    )
  }

  const currentIndex = Math.max(
    0,
    STATUS_STEPS.findIndex((step) => step.status === status),
  )

  return (
    <ol aria-label="Report progress" className="space-y-0">
      {STATUS_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
        const isLast = index === STATUS_STEPS.length - 1
        // The final step, once reached, is complete rather than in progress.
        const finished = state === 'done' || (state === 'current' && step.status === 'resolved')
        return (
          <li
            key={step.status}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex gap-3 pb-5 last:pb-0"
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute left-4 top-8 -ml-px h-[calc(100%-2rem)] w-0.5 ${
                  state === 'done' ? 'bg-success-500' : 'bg-gray-200'
                }`}
              />
            )}
            <span
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                finished
                  ? 'bg-success-500 text-white'
                  : state === 'current'
                    ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                    : 'border-2 border-gray-300 bg-white text-gray-400'
              }`}
            >
              {finished ? <Check size={16} aria-hidden="true" /> : index + 1}
            </span>
            <span className="flex flex-col justify-center min-h-8">
              <span
                className={
                  state === 'upcoming'
                    ? 'text-gray-500'
                    : state === 'current'
                      ? 'font-semibold text-gray-900'
                      : 'text-gray-700'
                }
              >
                {step.label}
              </span>
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
