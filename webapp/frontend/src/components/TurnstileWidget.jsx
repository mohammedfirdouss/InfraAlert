/**
 * TurnstileWidget: Cloudflare Turnstile challenge (ADR 0007).
 * OWNER: agent "photos-captcha". Placeholder until implemented.
 *
 * Exposes `reset()` through a ref: tokens are single-use, so the form resets the
 * widget after every submit attempt.
 *
 * @param {{ onToken: (token: string | null) => void }} props  null when expired/errored
 */
import { forwardRef } from 'react'

const TurnstileWidget = forwardRef(function TurnstileWidget(_props, _ref) {
  return <div data-testid="turnstile">Captcha (not built yet)</div>
})

export default TurnstileWidget
