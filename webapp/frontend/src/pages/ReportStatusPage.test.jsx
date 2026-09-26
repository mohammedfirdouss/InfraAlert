import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../api/client.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, getReport: vi.fn() }
})

vi.mock('../components/TurnstileWidget.jsx', () => ({
  default: () => <div data-testid="turnstile" />,
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: () => <div data-testid="marker" />,
}))

import { ApiError, getReport } from '../api/client.js'
import ReportStatusPage, { POLL_INTERVAL_MS, formatSubmittedAt } from './ReportStatusPage.jsx'

/** @returns {import('../api/client.js').Report} */
function makeReport(overrides = {}) {
  return {
    report_id: 'r-123',
    status: 'received',
    issue_type: null,
    description: 'Huge pothole outside the school gate',
    address_text: '12 Main Street',
    location: { lat: 6.524412345, lng: 3.379198765 },
    photo_count: 2,
    submitted_at: '2026-09-20T14:30:00Z',
    ...overrides,
  }
}

function renderPage({ id = 'r-123', state } = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/reports/${id}`, state }]}>
      <Routes>
        <Route path="/reports/:id" element={<ReportStatusPage />} />
        <Route path="/" element={<h1>Report form</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Let pending promises settle under fake timers. */
const flush = () => act(() => vi.advanceTimersByTimeAsync(0))
const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))

let visibility = 'visible'
function setVisibility(value) {
  visibility = value
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  getReport.mockReset()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

afterEach(() => {
  vi.useRealTimers()
  delete document.visibilityState
})

describe('ReportStatusPage', () => {
  test('shows a loading skeleton, then a received report', async () => {
    getReport.mockResolvedValue(makeReport())
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading report' })).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Report status' })).toBeInTheDocument()
    expect(getReport).toHaveBeenCalledWith('r-123')
    expect(screen.getByText(/We've received your report/)).toBeInTheDocument()
    expect(screen.getByText('Huge pothole outside the school gate')).toBeInTheDocument()
    expect(screen.getByText('12 Main Street')).toBeInTheDocument()
    expect(screen.getByText('2 photos attached')).toBeInTheDocument()
    expect(screen.getByText(formatSubmittedAt('2026-09-20T14:30:00Z'))).toBeInTheDocument()
    expect(screen.getByTestId('marker')).toBeInTheDocument()
    const current = screen.getByRole('list', { name: 'Report progress' }).querySelector('[aria-current="step"]')
    expect(current).toHaveTextContent('Received')
    expect(screen.queryByRole('heading', { name: 'Report sent' })).not.toBeInTheDocument()
  })

  test('issue type null shows "Being classified"; a set type shows its label', async () => {
    getReport.mockResolvedValue(makeReport({ issue_type: null }))
    const { unmount } = renderPage()
    expect(await screen.findByText('Being classified')).toBeInTheDocument()
    unmount()

    getReport.mockResolvedValue(makeReport({ issue_type: 'broken_streetlight', photo_count: 1 }))
    renderPage()
    expect(await screen.findByText('Broken streetlight')).toBeInTheDocument()
    expect(screen.queryByText('Being classified')).not.toBeInTheDocument()
    expect(screen.getByText('1 photo attached')).toBeInTheDocument()
  })

  test('falls back to coordinates to 5 decimals without address text', async () => {
    getReport.mockResolvedValue(makeReport({ address_text: null }))
    renderPage()
    expect(await screen.findByText('6.52441, 3.37920')).toBeInTheDocument()
  })

  test('justSubmitted shows a banner and copies the link', async () => {
    getReport.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    renderPage({ state: { justSubmitted: true } })
    expect(screen.getByRole('heading', { name: 'Report sent' })).toBeInTheDocument()
    expect(screen.getByText(/only way to follow/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(await screen.findByText('Link copied to your clipboard.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  test('copy link failure explains how to save the link instead', async () => {
    getReport.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    renderPage({ state: { justSubmitted: true } })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText(/Couldn't copy automatically/)).toBeInTheDocument()
  })

  test.each([404, 422])('%i shows a not-found message with a link to report again', async (status) => {
    getReport.mockRejectedValue(new ApiError(status, 'not_found'))
    renderPage({ id: 'bogus' })
    expect(await screen.findByRole('heading', { name: "We couldn't find this report" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Report a new issue' })).toHaveAttribute('href', '/')
  })

  test('a generic error offers Retry, which reloads the report', async () => {
    getReport.mockRejectedValueOnce(new ApiError(500, null)).mockResolvedValueOnce(makeReport())
    const user = userEvent.setup()
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't load this report")

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Report status' })).toBeInTheDocument()
    expect(getReport).toHaveBeenCalledTimes(2)
  })

  test('polls every 30 s until the status is final, then stops', async () => {
    vi.useFakeTimers()
    getReport
      .mockResolvedValueOnce(makeReport({ status: 'received' }))
      .mockResolvedValueOnce(makeReport({ status: 'in_progress' }))
      .mockResolvedValueOnce(makeReport({ status: 'resolved' }))
    renderPage()
    await flush()
    expect(getReport).toHaveBeenCalledTimes(1)

    await advance(POLL_INTERVAL_MS - 1)
    expect(getReport).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(getReport).toHaveBeenCalledTimes(2)
    expect(screen.getByText('A repair team is working on the problem now.')).toBeInTheDocument()

    await advance(POLL_INTERVAL_MS)
    expect(getReport).toHaveBeenCalledTimes(3)
    expect(screen.getByText(/The problem has been fixed/)).toBeInTheDocument()

    await advance(POLL_INTERVAL_MS * 5)
    expect(getReport).toHaveBeenCalledTimes(3)
  })

  test('does not poll a report that is already closed', async () => {
    vi.useFakeTimers()
    getReport.mockResolvedValue(makeReport({ status: 'closed' }))
    renderPage()
    await flush()
    await advance(POLL_INTERVAL_MS * 3)
    expect(getReport).toHaveBeenCalledTimes(1)
  })

  test('pauses polling while the tab is hidden and refreshes on return', async () => {
    vi.useFakeTimers()
    getReport.mockResolvedValue(makeReport({ status: 'under_review' }))
    renderPage()
    await flush()
    expect(getReport).toHaveBeenCalledTimes(1)

    act(() => setVisibility('hidden'))
    await advance(POLL_INTERVAL_MS * 4)
    expect(getReport).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await flush()
    expect(getReport).toHaveBeenCalledTimes(2)

    await advance(POLL_INTERVAL_MS)
    expect(getReport).toHaveBeenCalledTimes(3)
  })

  test('stops polling on unmount and ignores a late response', async () => {
    vi.useFakeTimers()
    let resolveLate
    getReport
      .mockResolvedValueOnce(makeReport())
      .mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)))
    const errorSpy = vi.spyOn(console, 'error')
    const { unmount } = renderPage()
    await flush()
    await advance(POLL_INTERVAL_MS)
    expect(getReport).toHaveBeenCalledTimes(2)

    unmount()
    await act(async () => resolveLate(makeReport({ status: 'resolved' })))
    await advance(POLL_INTERVAL_MS * 3)
    expect(getReport).toHaveBeenCalledTimes(2)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('a failed background refresh keeps showing the report', async () => {
    vi.useFakeTimers()
    getReport
      .mockResolvedValueOnce(makeReport({ status: 'team_assigned' }))
      .mockRejectedValueOnce(new ApiError(503, null))
      .mockResolvedValueOnce(makeReport({ status: 'in_progress' }))
    renderPage()
    await flush()
    await advance(POLL_INTERVAL_MS)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/A repair team has been assigned/)).toBeInTheDocument()
    await advance(POLL_INTERVAL_MS)
    expect(screen.getByText('A repair team is working on the problem now.')).toBeInTheDocument()
  })

  test('shows a short reference and a live indicator only while the report can still change', async () => {
    getReport.mockResolvedValue(makeReport({ report_id: 'b9e05251-aaaa-bbbb', status: 'in_progress' }))
    const { unmount } = renderPage({ id: 'b9e05251-aaaa-bbbb' })
    expect(await screen.findByText('REF B9E05251')).toBeInTheDocument()
    expect(screen.getByText('Reference: b9e05251-aaaa-bbbb')).toBeInTheDocument()
    expect(screen.getByText('Updates automatically')).toBeInTheDocument()
    unmount()

    getReport.mockResolvedValue(makeReport({ status: 'resolved' }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Report status' })).toBeInTheDocument()
    expect(screen.queryByText('Updates automatically')).not.toBeInTheDocument()
  })

  test('closed report shows the terminal state and a plain explanation', async () => {
    getReport.mockResolvedValue(makeReport({ status: 'closed' }))
    renderPage()
    expect(await screen.findByText(/closed without repair work/)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Report progress' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(list.querySelector('[aria-current="step"]')).toHaveTextContent('Closed')
    expect(document.body).not.toHaveTextContent(/triage|incident/i)
  })

  test.each([
    ['received', 'Received'],
    ['under_review', 'Under review'],
    ['team_assigned', 'Team assigned'],
    ['in_progress', 'In progress'],
    ['resolved', 'Resolved'],
  ])('status %s marks the "%s" step as current', async (status, label) => {
    getReport.mockResolvedValue(makeReport({ status }))
    renderPage()
    const list = await screen.findByRole('list', { name: 'Report progress' })
    expect(list.querySelector('[aria-current="step"]')).toHaveTextContent(label)
    expect(document.body).not.toHaveTextContent(/triage|incident/i)
  })

  test('offers email updates after the progress card, until the report is final', async () => {
    getReport.mockResolvedValue(makeReport())
    const { unmount } = renderPage()
    const signup = await screen.findByRole('region', { name: 'Get an email when this changes' })
    const progress = screen.getByRole('region', { name: /Progress/ })
    const details = screen.getByRole('region', { name: /Your report/ })
    expect(progress.compareDocumentPosition(signup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(signup.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()

    getReport.mockResolvedValue(makeReport({ updates_email_masked: 'a•••@gmail.com' }))
    const second = renderPage()
    expect(
      await screen.findByRole('heading', { name: 'Email updates are on for a•••@gmail.com' }),
    ).toBeInTheDocument()
    second.unmount()

    getReport.mockResolvedValue(makeReport({ status: 'resolved', updates_email_masked: 'a•••@gmail.com' }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Report status' })).toBeInTheDocument()
    expect(screen.queryByTestId('updates-signup')).not.toBeInTheDocument()
  })
})
