/**
 * ReportForm with the REAL PhotoPicker: the unit tests stub it, so they can't
 * catch the two drifting apart. Location and captcha are still stubbed
 * (Leaflet and Turnstile don't run in jsdom).
 */
import { forwardRef, useImperativeHandle } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import ReportForm from '../pages/ReportForm.jsx'
import { ApiError, requestUpload, submitReport, uploadPhoto } from '../api/client.js'

vi.mock('../api/client.js', async (importActual) => ({
  ...(await importActual()),
  requestUpload: vi.fn(),
  uploadPhoto: vi.fn(),
  submitReport: vi.fn(),
}))

vi.mock('../components/LocationPicker.jsx', () => ({
  default: ({ onChange }) => (
    <button type="button" onClick={() => onChange({ lat: -1.28, lng: 36.82 })}>
      Stub: set location
    </button>
  ),
}))

vi.mock('../components/TurnstileWidget.jsx', () => ({
  default: forwardRef(function StubTurnstile({ onToken }, ref) {
    useImperativeHandle(ref, () => ({ reset: () => onToken(null) }))
    return (
      <button type="button" onClick={() => onToken('token')}>
        Stub: solve captcha
      </button>
    )
  }),
}))

beforeEach(() => {
  let n = 0
  vi.mocked(requestUpload).mockImplementation(async (contentType) => ({
    object_name: `uploads/${String(++n).repeat(32)}.jpg`,
    upload_url: 'https://storage.test/put',
    method: 'PUT',
    headers: { 'Content-Type': contentType },
  }))
  vi.mocked(uploadPhoto).mockResolvedValue(undefined)
  vi.mocked(submitReport).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

test('after a 409 the uploaded photos are gone from both the screen and the next submit', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ReportForm />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
  await user.type(screen.getByLabelText(/what's wrong/i), 'Deep pothole near the bus stop')
  await user.upload(
    screen.getByLabelText(/add photos/i),
    new File(['x'], 'pothole.jpg', { type: 'image/jpeg' }),
  )
  await screen.findByRole('button', { name: /remove photo 1/i })

  vi.mocked(submitReport).mockRejectedValueOnce(new ApiError(409, 'photo_already_used'))
  await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
  await user.click(screen.getByRole('button', { name: /send report/i }))
  expect(vi.mocked(submitReport).mock.calls[0][0].photos).toEqual(['uploads/' + '1'.repeat(32) + '.jpg'])

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /remove photo 1/i })).not.toBeInTheDocument(),
  )

  vi.mocked(submitReport).mockResolvedValueOnce({ report_id: 'r1', status: 'received' })
  await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
  await user.click(screen.getByRole('button', { name: /send report/i }))
  expect(vi.mocked(submitReport).mock.calls[1][0].photos).toEqual([])
})
