import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import Unsubscribe from './Unsubscribe.jsx'
import { ApiError, unsubscribe } from '../api/client.js'

vi.mock('../api/client.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, unsubscribe: vi.fn() }
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</span>
}

function renderPage(entry = '/unsubscribe#token=unsub-1') {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/unsubscribe" element={<Unsubscribe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(() => {
  unsubscribe.mockReset()
})

describe('Unsubscribe', () => {
  test('stops updates with the token from the fragment, once, and removes it', async () => {
    unsubscribe.mockResolvedValue({ status: 'unsubscribed' })
    renderPage()

    expect(screen.getByTestId('url')).toHaveTextContent(/^\/unsubscribe$/)
    expect(
      await screen.findByText("You won't get any more emails about this report."),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Email updates stopped' })).toBeInTheDocument()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledWith('unsub-1')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('an invalid token gets a calm message', async () => {
    unsubscribe.mockRejectedValue(new ApiError(400, 'invalid_token'))
    renderPage()

    expect(
      await screen.findByRole('heading', { name: "We couldn't use this link" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('a missing token makes no request', () => {
    renderPage('/unsubscribe')
    expect(screen.getByRole('heading', { name: 'This link is missing a part' })).toBeInTheDocument()
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
