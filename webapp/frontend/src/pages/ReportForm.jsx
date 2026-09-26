/**
 * ReportForm: the citizen report page at "/".
 *
 * Citizens describe the problem in their own words; the system extracts the issue
 * type (ADR 0004). Reports are anonymous, so there is no contact field (ADR 0007).
 * Every report needs coordinates (ADR 0003). Emergencies are sent to the
 * emergency number instead (ADR 0005).
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Loader2, Phone, Send } from 'lucide-react'
import { ApiError, submitReport } from '../api/client.js'
import { config } from '../config.js'
import LocationPicker from '../components/LocationPicker.jsx'
import PhotoPicker from '../components/PhotoPicker.jsx'
import TurnstileWidget from '../components/TurnstileWidget.jsx'

const DESCRIPTION_MIN = 10
const DESCRIPTION_MAX = 2000
const ADDRESS_MAX = 300

/** Fields in page order; the first invalid one gets focus. */
const FIELD_ORDER = ['location', 'description', 'address', 'photos', 'captcha']

const MESSAGES = {
  location: 'Choose where the problem is on the map.',
  descriptionShort: `Describe the problem in at least ${DESCRIPTION_MIN} characters.`,
  descriptionLong: `Keep the description under ${DESCRIPTION_MAX} characters.`,
  address: `Keep the address or landmark under ${ADDRESS_MAX} characters.`,
  photos: 'There is a problem with the photos. Remove them and add them again.',
  captcha: 'The security check has not finished yet. Wait a moment for it to complete, then submit again.',
  captchaFailed: 'The security check failed. Please try again.',
  photoUsed:
    'One of your photos was already used in another report. We removed your photos; please add them again.',
  rateLimited: `Too many reports have been sent from this network in the last hour. Please try again later, or call the city if it can't wait.`,
  invalid: 'Please check the form and correct the highlighted fields.',
  network: "Couldn't reach InfraAlert. Your report has NOT been sent. Check your connection and try again.",
  unknown: 'Something went wrong. Your report has NOT been sent. Please try again.',
}

/** Maps a backend field name (from a 422 `loc`) to our field and message. */
const API_FIELD_MAP = {
  location: ['location', MESSAGES.location],
  description: ['description', MESSAGES.descriptionShort],
  address_text: ['address', MESSAGES.address],
  photos: ['photos', MESSAGES.photos],
  captcha_token: ['captcha', MESSAGES.captchaFailed],
}

/**
 * Field errors from a FastAPI validation error list.
 * @param {unknown} detail
 * @returns {Record<string, string>}
 */
function fieldErrorsFrom422(detail) {
  /** @type {Record<string, string>} */
  const errs = {}
  if (!Array.isArray(detail)) return errs
  for (const item of detail) {
    const loc = Array.isArray(item?.loc) ? item.loc : []
    const name = loc[0] === 'body' ? loc[1] : loc[0]
    const mapped = API_FIELD_MAP[name]
    if (!mapped) continue
    const [field, message] = mapped
    if (field === 'description' && typeof item?.msg === 'string' && /at most/i.test(item.msg)) {
      errs[field] ??= MESSAGES.descriptionLong
    } else {
      errs[field] ??= message
    }
  }
  return errs
}

function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-sm text-danger-600">
      {message}
    </p>
  )
}

function inputClass(hasError) {
  return `input ${hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : ''}`
}

export default function ReportForm() {
  const navigate = useNavigate()

  const [location, setLocation] = useState(/** @type {{lat:number,lng:number}|null} */ (null))
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [photos, setPhotos] = useState(/** @type {string[]} */ ([]))
  const [photosBusy, setPhotosBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState(/** @type {string|null} */ (null))
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}))
  const [formError, setFormError] = useState(/** @type {string|null} */ (null))
  const [submitting, setSubmitting] = useState(false)

  /** True once the citizen has typed their own address text; the map must not overwrite it. */
  const addressTypedRef = useRef(false)
  const turnstileRef = useRef(/** @type {{reset: () => void} | null} */ (null))
  const fieldRefs = {
    location: useRef(/** @type {HTMLElement|null} */ (null)),
    description: useRef(/** @type {HTMLElement|null} */ (null)),
    address: useRef(/** @type {HTMLElement|null} */ (null)),
    photos: useRef(/** @type {HTMLElement|null} */ (null)),
    captcha: useRef(/** @type {HTMLElement|null} */ (null)),
  }

  const trimmedLength = description.trim().length

  function clearError(field) {
    setErrors((e) => {
      if (!e[field]) return e
      const next = { ...e }
      delete next[field]
      return next
    })
  }

  function focusFirstError(errs) {
    const first = FIELD_ORDER.find((f) => errs[f])
    if (first) fieldRefs[first].current?.focus()
  }

  function handleLocationChange(point) {
    setLocation(point)
    clearError('location')
  }

  function handleAddressFromMap(text) {
    if (addressTypedRef.current) return
    setAddress((text ?? '').slice(0, ADDRESS_MAX))
    clearError('address')
  }

  function handleAddressTyped(e) {
    const value = e.target.value
    // Clearing the field hands it back to the map's suggestion.
    addressTypedRef.current = value.length > 0
    setAddress(value)
    clearError('address')
  }

  function handleCaptchaToken(token) {
    setCaptchaToken(token)
    if (token) clearError('captcha')
  }

  function validate() {
    /** @type {Record<string, string>} */
    const errs = {}
    if (!location) errs.location = MESSAGES.location
    if (trimmedLength < DESCRIPTION_MIN) errs.description = MESSAGES.descriptionShort
    else if (trimmedLength > DESCRIPTION_MAX) errs.description = MESSAGES.descriptionLong
    if (address.trim().length > ADDRESS_MAX) errs.address = MESSAGES.address
    if (!captchaToken) errs.captcha = MESSAGES.captcha
    return errs
  }

  function resetCaptcha() {
    // Tokens are single-use: every attempt, successful or not, needs a fresh one.
    setCaptchaToken(null)
    turnstileRef.current?.reset()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting || photosBusy) return
    setFormError(null)

    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      setFormError(errs.captcha && Object.keys(errs).length === 1 ? MESSAGES.captcha : MESSAGES.invalid)
      focusFirstError(errs)
      return
    }

    setErrors({})
    setSubmitting(true)
    const trimmedAddress = address.trim()
    try {
      const result = await submitReport({
        description: description.trim(),
        location: { lat: location.lat, lng: location.lng },
        address_text: trimmedAddress || null,
        photos,
        captcha_token: captchaToken,
      })
      resetCaptcha()
      navigate(`/reports/${result.report_id}`, { state: { justSubmitted: true } })
    } catch (err) {
      resetCaptcha()
      setSubmitting(false)
      handleSubmitError(err)
    }
  }

  function handleSubmitError(err) {
    if (err instanceof ApiError) {
      if (err.status === 400 && err.detail === 'captcha_failed') {
        setErrors({ captcha: MESSAGES.captchaFailed })
        setFormError(MESSAGES.captchaFailed)
        return
      }
      if (err.status === 409 && err.detail === 'photo_already_used') {
        setPhotos([])
        setErrors({ photos: MESSAGES.photoUsed })
        setFormError(MESSAGES.photoUsed)
        fieldRefs.photos.current?.focus()
        return
      }
      if (err.status === 429) {
        setFormError(MESSAGES.rateLimited)
        return
      }
      if (err.status === 422) {
        const errs = fieldErrorsFrom422(err.detail)
        setErrors(errs)
        setFormError(MESSAGES.invalid)
        focusFirstError(errs)
        return
      }
      setFormError(MESSAGES.unknown)
      return
    }
    if (err instanceof TypeError) {
      setFormError(MESSAGES.network)
      return
    }
    setFormError(MESSAGES.unknown)
  }

  /** aria props for a field that may have an error, plus optional hint ids. */
  function describedBy(field, ...hintIds) {
    const ids = [...hintIds, errors[field] ? `${field}-error` : null].filter(Boolean)
    return {
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': ids.length ? ids.join(' ') : undefined,
    }
  }

  const submitDisabled = submitting || photosBusy

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Emergency notice (ADR 0005) */}
      <section
        aria-labelledby="emergency-heading"
        className="mb-6 rounded-xl border-2 border-danger-500 bg-danger-50 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-danger-600" aria-hidden="true" />
          <div className="space-y-2">
            <h2 id="emergency-heading" className="text-base font-bold text-danger-600">
              Is someone in danger?
            </h2>
            <p className="text-sm text-gray-800">
              For a gas leak, live or fallen wires, fire, or anyone injured, call emergency
              services now. This form is not monitored in real time.
            </p>
            <a
              href={`tel:${config.emergencyNumber}`}
              className="btn-danger w-full sm:w-auto text-base py-2.5"
            >
              <Phone size={18} aria-hidden="true" />
              Call {config.emergencyNumber}
            </a>
          </div>
        </div>
      </section>

      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Report a problem</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tell us where it is and what's wrong. You don't need to give your name.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="card p-4 sm:p-6 space-y-6">
        {/* Where */}
        <div>
          <span id="location-label" className="label">
            Where is the problem? <span className="text-danger-600">*</span>
          </span>
          <div
            ref={fieldRefs.location}
            tabIndex={-1}
            role="group"
            aria-labelledby="location-label"
            {...describedBy('location')}
            className={`rounded-lg ${errors.location ? 'ring-2 ring-danger-500' : ''}`}
          >
            <LocationPicker
              value={location}
              onChange={handleLocationChange}
              onAddressChange={handleAddressFromMap}
            />
          </div>
          <FieldError id="location-error" message={errors.location} />
        </div>

        {/* What's wrong */}
        <div>
          <label htmlFor="description" className="label">
            What's wrong? <span className="text-danger-600">*</span>
          </label>
          <textarea
            ref={fieldRefs.description}
            id="description"
            name="description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              clearError('description')
            }}
            rows={5}
            placeholder="For example: a deep pothole in the left lane, about a metre wide. Cars are swerving around it."
            className={`${inputClass(!!errors.description)} resize-y text-base sm:text-sm`}
            {...describedBy('description', 'description-count')}
          />
          <div className="flex items-start justify-between gap-3">
            <FieldError id="description-error" message={errors.description} />
            <span
              id="description-count"
              className={`mt-1 ml-auto shrink-0 text-xs ${
                trimmedLength > DESCRIPTION_MAX ? 'text-danger-600 font-semibold' : 'text-gray-500'
              }`}
            >
              {trimmedLength}/{DESCRIPTION_MAX} characters
            </span>
          </div>
        </div>

        {/* Address / landmark */}
        <div>
          <label htmlFor="address" className="label">
            Address or nearby landmark{' '}
            <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            ref={fieldRefs.address}
            type="text"
            id="address"
            name="address"
            value={address}
            onChange={handleAddressTyped}
            maxLength={ADDRESS_MAX}
            placeholder="e.g. outside the market on Moi Avenue"
            autoComplete="off"
            className={`${inputClass(!!errors.address)} text-base sm:text-sm`}
            {...describedBy('address', 'address-hint')}
          />
          <p id="address-hint" className="mt-1 text-xs text-gray-500">
            Filled in from the map when possible. You can change it.
          </p>
          <FieldError id="address-error" message={errors.address} />
        </div>

        {/* Photos */}
        <div>
          <span id="photos-label" className="label">
            Photos <span className="font-normal text-gray-500">(optional)</span>
          </span>
          <div
            ref={fieldRefs.photos}
            tabIndex={-1}
            role="group"
            aria-labelledby="photos-label"
            {...describedBy('photos')}
          >
            <PhotoPicker
              value={photos}
              onChange={(names) => {
                setPhotos(names)
                clearError('photos')
              }}
              onBusyChange={setPhotosBusy}
              disabled={submitting}
            />
          </div>
          <FieldError id="photos-error" message={errors.photos} />
        </div>

        {/* Security check */}
        <div>
          <div
            ref={fieldRefs.captcha}
            tabIndex={-1}
            role="group"
            aria-label="Security check"
            {...describedBy('captcha')}
          >
            <TurnstileWidget ref={turnstileRef} onToken={handleCaptchaToken} />
          </div>
          <FieldError id="captcha-error" message={errors.captcha} />
        </div>

        {/* Form-level status, announced to screen readers */}
        <div aria-live="assertive" role="alert">
          {formError && (
            <div className="rounded-lg border border-danger-500 bg-danger-50 px-4 py-3 text-sm text-danger-600">
              {formError}
            </div>
          )}
        </div>

        {/* Submit */}
        <div>
          <button
            type="submit"
            disabled={submitDisabled}
            aria-describedby="submit-hint"
            className="btn-primary w-full py-3 text-base"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                Sending report…
              </>
            ) : (
              <>
                <Send size={18} aria-hidden="true" />
                Send report
              </>
            )}
          </button>
          <p id="submit-hint" aria-live="polite" className="mt-2 text-xs text-center text-gray-500">
            {photosBusy
              ? 'Waiting for your photos to finish uploading…'
              : !captchaToken
                ? 'The security check must finish before you can send the report.'
                : ''}
          </p>
        </div>
      </form>
    </div>
  )
}
