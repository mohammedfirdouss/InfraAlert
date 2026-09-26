import { forwardRef, useImperativeHandle } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import ReportForm from './ReportForm.jsx'
import { ApiError, submitReport } from '../api/client.js'
import { config } from '../config.js'

const { resetSpy } = vi.hoisted(() => ({ resetSpy: vi.fn() }))

vi.mock('../api/client.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, submitReport: vi.fn() }
})

vi.mock('../components/LocationPicker.jsx', () => ({
  default: ({ value, onChange, onAddressChange }) => (
    <div>
      <span data-testid="location-value">{value ? `${value.lat},${value.lng}` : 'none'}</span>
      <button type="button" onClick={() => onChange({ lat: -1.28, lng: 36.82 })}>
        Stub: set location
      </button>
      <button type="button" onClick={() => onAddressChange('Moi Avenue, Nairobi')}>
        Stub: map address
      </button>
      <button type="button" onClick={() => onAddressChange('Kenyatta Avenue')}>
        Stub: map address 2
      </button>
    </div>
  ),
}))

vi.mock('../components/PhotoPicker.jsx', () => ({
  default: ({ value, onChange, onBusyChange }) => (
    <div>
      <span data-testid="photos-value">{value.join(',') || 'none'}</span>
      <button type="button" onClick={() => onChange(['uploads/a.jpg', 'uploads/b.jpg'])}>
        Stub: add photos
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Stub: start upload
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        Stub: finish upload
      </button>
    </div>
  ),
}))

vi.mock('../components/TurnstileWidget.jsx', () => ({
  default: forwardRef(function StubTurnstile({ onToken }, ref) {
    useImperativeHandle(ref, () => ({ reset: resetSpy }))
    return (
      <button type="button" onClick={() => onToken('captcha-token-1')}>
        Stub: solve captcha
      </button>
    )
  }),
}))

function StatusStub() {
  const { id } = useParams()
  const { state } = useLocation()
  return (
    <div>
      <h1>Status {id}</h1>
      <p>{state?.justSubmitted ? 'just submitted' : 'not just submitted'}</p>
    </div>
  )
}

function renderForm() {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ReportForm />} />
        <Route path="/reports/:id" element={<StatusStub />} />
      </Routes>
    </MemoryRouter>,
  )
  return { user }
}

const DESCRIPTION = '  Deep pothole in the left lane near the bus stop.  '

async function fillValidForm(user, { photos = false } = {}) {
  await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
  await user.type(screen.getByLabelText(/what's wrong/i), DESCRIPTION)
  if (photos) await user.click(screen.getByRole('button', { name: 'Stub: add photos' }))
  await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
}

const submitButton = () => screen.getByRole('button', { name: /send report/i })

beforeEach(() => {
  resetSpy.mockReset()
  vi.mocked(submitReport).mockReset()
})

describe('ReportForm', () => {
  test('emergency notice links to the configured emergency number', () => {
    renderForm()
    const link = screen.getByRole('link', { name: `Call ${config.emergencyNumber}` })
    expect(link).toHaveAttribute('href', `tel:${config.emergencyNumber}`)
    expect(screen.getByText(/not monitored in real time/i)).toBeInTheDocument()
  })

  test('has no issue-type or phone fields', () => {
    renderForm()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument()
  })

  test('happy path submits the trimmed payload, resets the captcha and navigates', async () => {
    vi.mocked(submitReport).mockResolvedValue({ report_id: 'rpt-123', status: 'received' })
    const { user } = renderForm()

    await fillValidForm(user, { photos: true })
    await user.click(screen.getByRole('button', { name: 'Stub: map address' }))
    await user.click(submitButton())

    expect(await screen.findByRole('heading', { name: 'Status rpt-123' })).toBeInTheDocument()
    expect(screen.getByText('just submitted')).toBeInTheDocument()
    expect(submitReport).toHaveBeenCalledTimes(1)
    expect(submitReport).toHaveBeenCalledWith({
      description: DESCRIPTION.trim(),
      location: { lat: -1.28, lng: 36.82 },
      address_text: 'Moi Avenue, Nairobi',
      photos: ['uploads/a.jpg', 'uploads/b.jpg'],
      captcha_token: 'captcha-token-1',
    })
    expect(resetSpy).toHaveBeenCalledTimes(1)
  })

  test('sends null address and no photos when they are left empty', async () => {
    vi.mocked(submitReport).mockResolvedValue({ report_id: 'r1', status: 'received' })
    const { user } = renderForm()
    await fillValidForm(user)
    await user.click(submitButton())
    await screen.findByRole('heading', { name: 'Status r1' })
    expect(submitReport).toHaveBeenCalledWith(
      expect.objectContaining({ address_text: null, photos: [] }),
    )
  })

  test('shows the live trimmed character count', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText(/what's wrong/i), '  hello  ')
    expect(screen.getByText('5 of 2000 characters')).toBeInTheDocument()
  })

  test('validation errors block submission, focus the first invalid field and clear on edit', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText(/what's wrong/i), ' short ')
    await user.click(submitButton())

    expect(submitReport).not.toHaveBeenCalled()
    expect(screen.getByText(/choose where the problem is/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument()
    expect(screen.getByText(/security check has not finished/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/please check the form/i)

    const locationGroup = screen.getByRole('group', { name: /where is the problem/i })
    expect(locationGroup).toHaveFocus()
    expect(locationGroup).toHaveAttribute('aria-invalid', 'true')

    const textarea = screen.getByLabelText(/what's wrong/i)
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea.getAttribute('aria-describedby')).toContain('description-error')

    await user.type(textarea, 'and more words')
    expect(screen.queryByText(/at least 10 characters/i)).not.toBeInTheDocument()
    expect(textarea).not.toHaveAttribute('aria-invalid')

    await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
    expect(screen.queryByText(/choose where the problem is/i)).not.toBeInTheDocument()
  })

  test('focuses the description when only it is invalid', async () => {
    const { user } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
    await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
    await user.click(submitButton())
    expect(screen.getByLabelText(/what's wrong/i)).toHaveFocus()
    expect(submitReport).not.toHaveBeenCalled()
  })

  test('rejects descriptions over 2000 characters after trimming', async () => {
    const { user } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
    const textarea = screen.getByLabelText(/what's wrong/i)
    await user.click(textarea)
    await user.paste('x'.repeat(2001))
    await user.click(screen.getByRole('button', { name: 'Stub: solve captcha' }))
    await user.click(submitButton())
    expect(screen.getByText(/under 2000 characters/i)).toBeInTheDocument()
    expect(submitReport).not.toHaveBeenCalled()
  })

  test('explains the security check when there is no captcha token', async () => {
    const { user } = renderForm()
    expect(screen.getByText(/security check must finish/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stub: set location' }))
    await user.type(screen.getByLabelText(/what's wrong/i), DESCRIPTION)
    await user.click(submitButton())
    expect(submitReport).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/security check has not finished/i)
  })

  test('submit is disabled while photos are uploading', async () => {
    const { user } = renderForm()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: 'Stub: start upload' }))
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText(/waiting for your photos/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stub: finish upload' }))
    expect(submitButton()).toBeEnabled()
  })

  test('submit is disabled while submitting', async () => {
    let resolve
    vi.mocked(submitReport).mockReturnValue(new Promise((r) => (resolve = r)))
    const { user } = renderForm()
    await fillValidForm(user)
    await user.click(submitButton())
    expect(screen.getByRole('button', { name: /sending report/i })).toBeDisabled()
    resolve({ report_id: 'r2', status: 'received' })
    await screen.findByRole('heading', { name: 'Status r2' })
  })

  describe('address prefill', () => {
    test('fills the address from the map until the citizen types their own', async () => {
      const { user } = renderForm()
      const address = screen.getByLabelText(/address or nearby landmark/i)

      await user.click(screen.getByRole('button', { name: 'Stub: map address' }))
      expect(address).toHaveValue('Moi Avenue, Nairobi')

      await user.clear(address)
      await user.type(address, 'Opposite the big mango tree')
      await user.click(screen.getByRole('button', { name: 'Stub: map address 2' }))
      expect(address).toHaveValue('Opposite the big mango tree')
    })

    test('an edited prefill is not overwritten either', async () => {
      const { user } = renderForm()
      const address = screen.getByLabelText(/address or nearby landmark/i)
      await user.click(screen.getByRole('button', { name: 'Stub: map address' }))
      await user.type(address, ', gate 2')
      await user.click(screen.getByRole('button', { name: 'Stub: map address 2' }))
      expect(address).toHaveValue('Moi Avenue, Nairobi, gate 2')
    })
  })

  describe('submit errors keep what the citizen typed and reset the captcha', () => {
    /** @param {unknown} error */
    async function submitWithError(error) {
      vi.mocked(submitReport).mockRejectedValue(error)
      const { user } = renderForm()
      await fillValidForm(user, { photos: true })
      await user.click(screen.getByRole('button', { name: 'Stub: map address' }))
      await user.click(submitButton())
      await waitFor(() => expect(submitButton()).toBeEnabled())
      expect(resetSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText(/what's wrong/i)).toHaveValue(DESCRIPTION)
      expect(screen.getByLabelText(/address or nearby landmark/i)).toHaveValue('Moi Avenue, Nairobi')
      expect(screen.getByTestId('location-value')).toHaveTextContent('-1.28,36.82')
      return { user }
    }

    test('400 captcha_failed', async () => {
      await submitWithError(new ApiError(400, 'captcha_failed'))
      expect(screen.getByRole('alert')).toHaveTextContent(/security check failed\. please try again/i)
      expect(screen.getByTestId('photos-value')).toHaveTextContent('uploads/a.jpg,uploads/b.jpg')
    })

    test('409 photo_already_used clears the photos and asks for them again', async () => {
      await submitWithError(new ApiError(409, 'photo_already_used'))
      expect(screen.getByTestId('photos-value')).toHaveTextContent('none')
      expect(screen.getByRole('alert')).toHaveTextContent(/please add them again/i)
    })

    test('429 rate limited', async () => {
      await submitWithError(new ApiError(429, 'rate_limited'))
      expect(screen.getByRole('alert')).toHaveTextContent(/too many reports.*this network.*last hour/i)
      expect(screen.getByRole('alert')).toHaveTextContent(/call the city/i)
    })

    test('422 shows a generic message and maps fields', async () => {
      await submitWithError(
        new ApiError(422, [
          { loc: ['body', 'description'], msg: 'String should have at least 10 characters', type: 'string_too_short' },
        ]),
      )
      expect(screen.getByRole('alert')).toHaveTextContent(/please check the form/i)
      expect(screen.getByLabelText(/what's wrong/i)).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(/what's wrong/i)).toHaveFocus()
    })

    test('network failure says the report was not sent', async () => {
      await submitWithError(new TypeError('Failed to fetch'))
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't reach InfraAlert/i)
      expect(screen.getByRole('alert')).toHaveTextContent(/has NOT been sent/)
    })

    test('a retry needs a fresh captcha token', async () => {
      const { user } = await submitWithError(new ApiError(429, 'rate_limited'))
      await user.click(submitButton())
      expect(submitReport).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alert')).toHaveTextContent(/security check has not finished/i)
    })
  })
})
