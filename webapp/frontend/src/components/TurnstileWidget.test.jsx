import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Fresh module per test so the module-level script promise starts empty. */
async function loadWidget() {
  vi.resetModules()
  return (await import('./TurnstileWidget.jsx')).default
}

function scripts() {
  return Array.from(document.querySelectorAll('script')).filter((s) => s.src === SRC)
}

function stubTurnstile() {
  const api = {
    render: vi.fn(() => 'widget-1'),
    remove: vi.fn(),
    reset: vi.fn(),
  }
  return api
}

async function fireLoad(api) {
  const [script] = scripts()
  window.turnstile = api
  await act(async () => {
    script.dispatchEvent(new Event('load'))
  })
}

async function fireError() {
  const [script] = scripts()
  await act(async () => {
    script.dispatchEvent(new Event('error'))
  })
}

beforeEach(() => {
  delete window.turnstile
})

afterEach(() => {
  delete window.turnstile
  scripts().forEach((s) => s.remove())
})

describe('TurnstileWidget', () => {
  it('loads the script once and renders with the site key', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    const { unmount } = render(<TurnstileWidget onToken={() => {}} />)
    // A second widget (or a StrictMode re-run) reuses the pending load.
    render(<TurnstileWidget onToken={() => {}} />)
    expect(scripts()).toHaveLength(1)

    await fireLoad(api)
    expect(api.render).toHaveBeenCalledTimes(2)
    const [container, options] = api.render.mock.calls[0]
    expect(container).toBeInstanceOf(HTMLElement)
    expect(options.sitekey).toBe(config.turnstileSiteKey)

    unmount()
    render(<TurnstileWidget onToken={() => {}} />)
    expect(scripts()).toHaveLength(1)
  })

  it('passes tokens and expiry/error to onToken, using the latest callback', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    const first = vi.fn()
    const onToken = vi.fn()
    const { rerender } = render(<TurnstileWidget onToken={first} />)
    await fireLoad(api)
    rerender(<TurnstileWidget onToken={onToken} />)
    expect(api.render).toHaveBeenCalledTimes(1) // not re-rendered on new callback

    const options = api.render.mock.calls[0][1]
    act(() => options.callback('tok-123'))
    expect(onToken).toHaveBeenLastCalledWith('tok-123')
    act(() => options['expired-callback']())
    expect(onToken).toHaveBeenLastCalledWith(null)
    act(() => options.callback('tok-456'))
    act(() => options['error-callback']())
    expect(onToken).toHaveBeenLastCalledWith(null)
    expect(first).not.toHaveBeenCalled()
  })

  it('reset() via ref resets the widget and clears the token', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    const onToken = vi.fn()
    const ref = createRef()
    render(<TurnstileWidget ref={ref} onToken={onToken} />)
    await fireLoad(api)

    act(() => ref.current.reset())
    expect(api.reset).toHaveBeenCalledWith('widget-1')
    expect(onToken).toHaveBeenLastCalledWith(null)
  })

  it('keeps delivering fresh tokens to the latest onToken after reset', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    const first = vi.fn()
    const latest = vi.fn()
    const ref = createRef()
    const { rerender } = render(<TurnstileWidget ref={ref} onToken={first} />)
    await fireLoad(api)
    const options = api.render.mock.calls[0][1]
    act(() => options.callback('tok-1'))
    expect(first).toHaveBeenLastCalledWith('tok-1')

    act(() => ref.current.reset())
    rerender(<TurnstileWidget ref={ref} onToken={latest} />)
    act(() => options.callback('tok-2'))
    expect(latest).toHaveBeenLastCalledWith('tok-2')

    act(() => ref.current.reset())
    expect(latest).toHaveBeenLastCalledWith(null)
    act(() => options.callback('tok-3'))
    expect(latest).toHaveBeenLastCalledWith('tok-3')
    expect(api.render).toHaveBeenCalledTimes(1)
    expect(api.reset).toHaveBeenCalledTimes(2)
    expect(first).not.toHaveBeenCalledWith('tok-2')
  })

  it('removes the widget on unmount', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    const { unmount } = render(<TurnstileWidget onToken={() => {}} />)
    await fireLoad(api)
    unmount()
    expect(api.remove).toHaveBeenCalledWith('widget-1')
  })

  it('renders immediately when Turnstile is already on the page', async () => {
    const TurnstileWidget = await loadWidget()
    const api = stubTurnstile()
    window.turnstile = api
    await act(async () => {
      render(<TurnstileWidget onToken={() => {}} />)
    })
    expect(scripts()).toHaveLength(0)
    expect(api.render).toHaveBeenCalledTimes(1)
  })

  it('shows a message on load failure and retries', async () => {
    const TurnstileWidget = await loadWidget()
    const onToken = vi.fn()
    render(<TurnstileWidget onToken={onToken} />)
    await fireError()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the security check/i)
    expect(onToken).toHaveBeenLastCalledWith(null)
    expect(scripts()).toHaveLength(0) // failed script removed

    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(scripts()).toHaveLength(1)
    const api = stubTurnstile()
    await fireLoad(api)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.render).toHaveBeenCalledTimes(1)
  })
})
