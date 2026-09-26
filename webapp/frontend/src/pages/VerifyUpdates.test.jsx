import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import VerifyUpdates from './VerifyUpdates.jsx'
import { ApiError, verifyUpdates } from '../api/client.js'

vi.mock('../api/client.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, verifyUpdates: vi.fn() }
})

/** Shows the router's current URL so tests can check the fragment was removed. */
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</span>
}

function ReportStub() {
  const { id } = useParams()
  return <h1>Report {id}</h1>
}

function renderPage(entry = '/reports/r-123/verify#token=tok-abc') {
  const user = userEvent.setup()
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/reports/:id/verify" element={<VerifyUpdates />} />
          <Route path="/reports/:id" element={<ReportStub />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </StrictMode>,
  )
  return user
}

beforeEach(() => {
  verifyUpdates.mockReset()
})

describe('VerifyUpdates', () => {
  test('reads the token from the fragment, removes it and verifies once', async () => {
    let resolve
    verifyUpdates.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Confirming your email…')
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/reports\/r-123\/verify$/)
    expect(verifyUpdates).toHaveBeenCalledTimes(1)
    expect(verifyUpdates).toHaveBeenCalledWith('r-123', 'tok-abc')

    resolve({ status: 'subscribed', email_masked: 'a•••@gmail.com' })
    expect(await screen.findByRole('heading', { name: 'Email updates are on' })).toBeInTheDocument()
    expect(verifyUpdates).toHaveBeenCalledTimes(1)
  })

  test('success shows the masked address and links back to the report', async () => {
    verifyUpdates.mockResolvedValue({ status: 'subscribed', email_masked: 'a•••@gmail.com' })
    const user = renderPage()

    expect(await screen.findByText('a•••@gmail.com')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'See your report' }))
    expect(screen.getByRole('heading', { name: 'Report r-123' })).toBeInTheDocument()
  })

  test('an invalid or expired link explains calmly and points to the report', async () => {
    verifyUpdates.mockRejectedValue(new ApiError(400, 'invalid_or_expired_token'))
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'This link has expired or was already used' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/ask for a new link on your report's page/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to your report' })).toHaveAttribute(
      'href',
      '/reports/r-123',
    )
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/reports\/r-123\/verify$/)
  })

  test('a missing token says the link is incomplete and makes no request', () => {
    renderPage('/reports/r-123/verify')
    expect(
      screen.getByRole('heading', { name: 'This link is missing a part' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to your report' })).toHaveAttribute(
      'href',
      '/reports/r-123',
    )
    expect(verifyUpdates).not.toHaveBeenCalled()
  })

  test('a fragment without a token counts as missing', () => {
    renderPage('/reports/r-123/verify#foo=bar')
    expect(screen.getByRole('heading', { name: 'This link is missing a part' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/reports\/r-123\/verify$/)
    expect(verifyUpdates).not.toHaveBeenCalled()
  })

  test('a network failure offers to try again with the same token', async () => {
    verifyUpdates
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ status: 'subscribed', email_masked: 'a•••@gmail.com' })
    const user = renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't confirm your email")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Email updates are on' })).toBeInTheDocument()
    expect(verifyUpdates).toHaveBeenCalledTimes(2)
    expect(verifyUpdates).toHaveBeenLastCalledWith('r-123', 'tok-abc')
  })
})
