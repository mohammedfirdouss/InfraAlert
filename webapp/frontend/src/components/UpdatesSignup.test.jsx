import { forwardRef, useImperativeHandle } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import UpdatesSignup, { MESSAGES } from './UpdatesSignup.jsx'
import { ApiError, subscribeToUpdates } from '../api/client.js'

const { resetSpy } = vi.hoisted(() => ({ resetSpy: vi.fn() }))

vi.mock('../api/client.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, subscribeToUpdates: vi.fn() }
})

vi.mock('./TurnstileWidget.jsx', () => ({
  default: forwardRef(function StubTurnstile({ onToken }, ref) {
    useImperativeHandle(ref, () => ({
      reset: () => {
        resetSpy()
        onToken(null)
      },
    }))
    return (
      <button type="button" onClick={() => onToken('captcha-token-1')}>
        Stub: solve captcha
      </button>
    )
  }),
}))

beforeEach(() => {
  subscribeToUpdates.mockReset()
  resetSpy.mockReset()
})

function renderSignup(props = {}) {
  const user = userEvent.setup()
  render(<UpdatesSignup reportId="r-123" maskedEmail={null} status="received" {...props} />)
  return user
}

async function fillAndSend(user, email = 'ada@example.com') {
  await user.type(screen.getByLabelText('Your email address'), email)
  await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
  await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
}

describe('UpdatesSignup', () => {
  test('explains the offer plainly and uses a 16px email input', () => {
    renderSignup()
    expect(
      screen.getByRole('heading', { name: 'Get an email when this changes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(screen.getByText(/when a repair team is assigned and when the problem is fixed/)).toBeInTheDocument()
    expect(screen.getByText(/you can stop any time/)).toBeInTheDocument()
    const input = screen.getByLabelText('Your email address')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('autocomplete', 'email')
    expect(input).toHaveClass('input')
  })

  test('sends the trimmed email with the captcha token, then shows the inbox message', async () => {
    subscribeToUpdates.mockResolvedValue({ status: 'verification_sent' })
    const user = renderSignup()
    await fillAndSend(user, '  ada@example.com ')

    expect(subscribeToUpdates).toHaveBeenCalledTimes(1)
    expect(subscribeToUpdates).toHaveBeenCalledWith('r-123', {
      email: 'ada@example.com',
      captcha_token: 'captcha-token-1',
    })
    expect(await screen.findByText('Check your inbox: we sent a link to confirm.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('ada@example.com')
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Confirm your email' })).toHaveFocus()
    expect(screen.queryByLabelText('Your email address')).not.toBeInTheDocument()
  })

  test('"Use a different address" brings back an empty form', async () => {
    subscribeToUpdates.mockResolvedValue({ status: 'verification_sent' })
    const user = renderSignup()
    await fillAndSend(user)
    await user.click(await screen.findByRole('button', { name: 'Use a different address' }))

    const input = screen.getByLabelText('Your email address')
    expect(input).toHaveValue('')
    await waitFor(() => expect(input).toHaveFocus())

    await fillAndSend(user, 'grace@example.com')
    expect(subscribeToUpdates).toHaveBeenLastCalledWith('r-123', {
      email: 'grace@example.com',
      captcha_token: 'captcha-token-1',
    })
    expect(await screen.findByText('grace@example.com')).toBeInTheDocument()
  })

  test('checks the email before spending the captcha', async () => {
    const user = renderSignup()
    await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
    expect(screen.getByText(MESSAGES.emailMissing)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Your email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
    expect(screen.getByText(MESSAGES.emailInvalid)).toBeInTheDocument()
    expect(screen.getByLabelText('Your email address')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Your email address')).toHaveFocus()
    expect(subscribeToUpdates).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
  })

  test('asks to wait when the security check has not finished', async () => {
    const user = renderSignup()
    await user.type(screen.getByLabelText('Your email address'), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.captchaPending)
    expect(subscribeToUpdates).not.toHaveBeenCalled()
  })

  test.each([
    ['captcha_failed', new ApiError(400, 'captcha_failed'), MESSAGES.captchaFailed],
    ['rate_limited', new ApiError(429, 'rate_limited'), MESSAGES.rateLimited],
    ['email_unavailable', new ApiError(503, 'email_unavailable'), MESSAGES.emailUnavailable],
    ['email_disabled', new ApiError(503, 'email_disabled'), MESSAGES.emailUnavailable],
    ['network failure', new TypeError('Failed to fetch'), MESSAGES.network],
    ['unknown error', new ApiError(500, null), MESSAGES.unknown],
  ])('%s shows a plain message and resets the captcha', async (_, error, message) => {
    subscribeToUpdates.mockRejectedValue(error)
    const user = renderSignup()
    await fillAndSend(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    // Still on the form, with the address kept for another try.
    expect(screen.getByLabelText('Your email address')).toHaveValue('ada@example.com')
  })

  test('a 422 marks the email field as invalid', async () => {
    subscribeToUpdates.mockRejectedValue(
      new ApiError(422, [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }]),
    )
    const user = renderSignup()
    await fillAndSend(user)

    expect(await screen.findByText(MESSAGES.emailInvalid)).toBeInTheDocument()
    const input = screen.getByLabelText('Your email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(expect.stringContaining(MESSAGES.emailInvalid))
    expect(resetSpy).toHaveBeenCalledTimes(1)
  })

  test('needs a fresh captcha after every attempt', async () => {
    subscribeToUpdates.mockRejectedValueOnce(new ApiError(400, 'captcha_failed'))
    subscribeToUpdates.mockResolvedValueOnce({ status: 'verification_sent' })
    const user = renderSignup()
    await fillAndSend(user)
    await screen.findByText(MESSAGES.captchaFailed)

    // The used token was cleared: sending again without solving asks to wait.
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.captchaPending)
    expect(subscribeToUpdates).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))
    expect(await screen.findByText('Check your inbox: we sent a link to confirm.')).toBeInTheDocument()
    expect(subscribeToUpdates).toHaveBeenCalledTimes(2)
    expect(resetSpy).toHaveBeenCalledTimes(2)
  })

  test('shows that updates are on instead of the form when an address is confirmed', () => {
    renderSignup({ maskedEmail: 'a•••@gmail.com' })
    expect(
      screen.getByRole('heading', { name: 'Email updates are on for a•••@gmail.com' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Your email address')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send confirmation email' })).not.toBeInTheDocument()
  })

  test.each(['resolved', 'closed'])('renders nothing once the report is %s', (status) => {
    const { container } = render(
      <UpdatesSignup reportId="r-123" maskedEmail="a•••@gmail.com" status={status} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
