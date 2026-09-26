/**
 * Unsubscribe: stops email updates from the link in any update email
 * (/unsubscribe#token=…). The token is read once and removed from the address bar.
 */
import { Check } from 'lucide-react'
import { unsubscribe } from '../api/client.js'
import {
  LinkProblem,
  RetryableError,
  TokenPageShell,
  Working,
  isInvalidToken,
  useFragmentTokenCall,
} from './VerifyUpdates.jsx'

/** Unsubscribe: the page behind "Stop these emails". */
export default function Unsubscribe() {
  const { state, retry } = useFragmentTokenCall(unsubscribe)

  let body
  if (state.phase === 'working') {
    body = <Working label="Stopping your email updates…" />
  } else if (state.phase === 'done') {
    body = (
      <section
        aria-labelledby="unsubscribed-heading"
        className="animate-rise-in rounded-xl border-2 border-ink bg-white p-6 text-center shadow-plate sm:p-8"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-go-500 text-white ring-4 ring-go-100">
          <Check size={30} strokeWidth={3} aria-hidden="true" />
        </span>
        <h1 id="unsubscribed-heading" className="mt-5 text-3xl font-black leading-tight">
          Email updates stopped
        </h1>
        <p className="mt-3 text-[15px] leading-snug text-asphalt-600">
          You won&apos;t get any more emails about this report.
        </p>
      </section>
    )
  } else if (state.phase === 'failed' && !isInvalidToken(state.error)) {
    body = <RetryableError onRetry={retry} what="stop your email updates" />
  } else {
    const missing = state.phase === 'missing'
    body = (
      <LinkProblem
        code={missing ? 'Link incomplete' : 'Link not recognised'}
        title={missing ? 'This link is missing a part' : "We couldn't use this link"}
      >
        <p className="mx-auto mt-3 max-w-md text-asphalt-600">
          {missing
            ? 'Try opening the link from the email again, or copy the whole link into your browser.'
            : "It may have been copied incompletely. Try the link in the most recent update email; if updates are already off, there's nothing more to do."}
        </p>
      </LinkProblem>
    )
  }

  return <TokenPageShell>{body}</TokenPageShell>
}
