import { RefreshCw, TriangleAlert } from 'lucide-react'

const ICON = { size: 18, strokeWidth: 2.25, 'aria-hidden': true }

/**
 * A failed request that is worth trying again: "We couldn't <what>".
 * @param {{ onRetry: () => void, what: string, retryLabel?: string }} props
 */
export default function RetryableError({ onRetry, what, retryLabel = 'Try again' }) {
  return (
    <div
      role="alert"
      className="animate-rise-in rounded-xl border-2 border-hazard-500 bg-hazard-50 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert {...ICON} size={22} className="mt-1 shrink-0 text-hazard-600" />
        <div className="min-w-0">
          <h1 className="text-xl font-black">We couldn&apos;t {what}</h1>
          <p className="mt-1 text-asphalt-600">
            Something went wrong on our side or with your connection. Please try again.
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
            <RefreshCw {...ICON} />
            {retryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
