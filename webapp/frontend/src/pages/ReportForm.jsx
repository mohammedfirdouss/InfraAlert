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
import { AlertCircle, AlertTriangle, ArrowRight, Loader2, MapPin, Phone } from 'lucide-react'
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

const ICON = { size: 18, strokeWidth: 2.25, 'aria-hidden': true }

function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="field-error animate-rise-in">
      <AlertCircle size={15} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

/** "01  WHERE": the field-report section header. */
function SectionHeading({ no, children }) {
  return (
    <h2 className="mb-5 flex items-center gap-3">
      <span className="section-no">{no}</span>
      <span className="section-title">{children}</span>
      <span className="h-px flex-1 bg-concrete-200" aria-hidden="true" />
    </h2>
  )
}

/** Small marker after a field label. */
function Marker({ children }) {
  return (
    <span className="ml-2 align-middle font-mono text-[11px] font-semibold uppercase tracking-sign text-asphalt-400">
      {children}
    </span>
  )
}

const QUESTION = 'mb-3 block text-lg font-extrabold leading-snug text-ink'

const STEPS = [
  ['Pin it', 'Tap the map or use your location'],
  ['Describe it', 'In your own words'],
  ['We route it', 'To the right repair crew'],
]

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
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
      {/* Page intro */}
      <header className="animate-rise-in">
        <p className="tag">Citizen report · about 1 minute</p>
        <h1 className="mt-4 text-3xl font-black leading-[1.05] tracking-tight text-ink sm:text-4xl">
          Report a problem on your street
        </h1>
        <p className="mt-3 max-w-lg text-base text-asphalt-600">
          Tell us where it is and what&apos;s wrong. You don&apos;t need to give your name.
        </p>
        <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="How it works">
          {STEPS.map(([title, detail], i) => (
            <li
              key={title}
              className="flex flex-col gap-1.5 rounded-md border border-concrete-300 bg-white/70 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-2.5"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink font-mono text-xs font-semibold text-signal-400"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold leading-tight text-ink">{title}</span>
                <span className="mt-0.5 hidden text-xs leading-snug text-asphalt-500 sm:block">
                  {detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </header>

      {/* Emergency notice (ADR 0005) */}
      <section
        aria-labelledby="emergency-heading"
        className="mt-8 flex overflow-hidden rounded-xl border-2 border-ink bg-hazard-500 text-ink shadow-plate"
      >
        <div className="hazard-edge w-3 shrink-0 border-r-2 border-ink sm:w-4" aria-hidden="true" />
        <div className="flex flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
          <div className="flex-1">
            <h2
              id="emergency-heading"
              className="flex items-center gap-2 text-lg font-black leading-tight"
            >
              <AlertTriangle size={20} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
              Is someone in danger?
            </h2>
            <p className="mt-1.5 text-sm font-semibold leading-snug">
              For a gas leak, live or fallen wires, fire, or anyone injured, call emergency
              services now. This form is not monitored in real time.
            </p>
          </div>
          <a
            href={`tel:${config.emergencyNumber}`}
            className="btn-secondary min-h-[56px] w-full shrink-0 gap-3 px-5 shadow-plate sm:w-auto"
          >
            <Phone size={20} strokeWidth={2.5} aria-hidden="true" />
            <span className="text-sm font-extrabold uppercase tracking-sign">Call</span>{' '}
            <span className="font-mono text-2xl font-bold tracking-tight">
              {config.emergencyNumber}
            </span>
          </a>
        </div>
      </section>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="card mt-8 divide-y divide-concrete-200"
      >
        {/* 01 Where */}
        <div className="p-5 sm:p-7">
          <SectionHeading no="01">
            Where
          </SectionHeading>
          <span id="location-label" className={QUESTION}>
            Where is the problem?
            <Marker>Required</Marker>
          </span>
          <div
            ref={fieldRefs.location}
            tabIndex={-1}
            role="group"
            aria-labelledby="location-label"
            {...describedBy('location')}
            className={`rounded-xl ${errors.location ? 'ring-2 ring-hazard-500 ring-offset-4' : ''}`}
          >
            <LocationPicker
              value={location}
              onChange={handleLocationChange}
              onAddressChange={handleAddressFromMap}
            />
          </div>
          <FieldError id="location-error" message={errors.location} />
        </div>

        {/* 02 What's wrong */}
        <div className="p-5 sm:p-7">
          <SectionHeading no="02">
            What&apos;s wrong
          </SectionHeading>
          <div>
            <label htmlFor="description" className={QUESTION}>
              What&apos;s wrong?
              <Marker>Required</Marker>
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
              className="input min-h-[8rem] resize-y leading-relaxed"
              {...describedBy('description', 'description-hint', 'description-count')}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="description-hint" className="hint">
                  Say what you see, roughly how big it is, and if it&apos;s getting worse.
                </p>
                <FieldError id="description-error" message={errors.description} />
              </div>
              <span
                id="description-count"
                className={`mt-1.5 shrink-0 font-mono text-xs tabular-nums ${
                  trimmedLength > DESCRIPTION_MAX ? 'font-bold text-hazard-700' : 'text-asphalt-500'
                }`}
              >
                <span aria-hidden="true">
                  {trimmedLength} / {DESCRIPTION_MAX}
                </span>
                <span className="sr-only">
                  {trimmedLength} of {DESCRIPTION_MAX} characters
                </span>
              </span>
            </div>
          </div>

          <div className="mt-7">
            <label htmlFor="address" className="label">
              Address or nearby landmark
              <Marker>Optional</Marker>
            </label>
            <div className="relative">
              <MapPin
                {...ICON}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-asphalt-400"
              />
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
                className="input pl-10"
                {...describedBy('address', 'address-hint')}
              />
            </div>
            <p id="address-hint" className="hint">
              Filled in from the map when possible. You can change it.
            </p>
            <FieldError id="address-error" message={errors.address} />
          </div>
        </div>

        {/* 03 Photos */}
        <div className="p-5 sm:p-7">
          <SectionHeading no="03">
            Photos
          </SectionHeading>
          <span id="photos-label" className={QUESTION}>
            Photos of the problem
            <Marker>Optional</Marker>
          </span>
          <div
            ref={fieldRefs.photos}
            tabIndex={-1}
            role="group"
            aria-labelledby="photos-label"
            {...describedBy('photos')}
            className="rounded-lg"
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

        {/* 04 Send */}
        <div className="p-5 sm:p-7">
          <SectionHeading no="04">
            Send
          </SectionHeading>

          <div>
            <p id="captcha-label" className="label">
              Security check
            </p>
            <div
              ref={fieldRefs.captcha}
              tabIndex={-1}
              role="group"
              aria-labelledby="captcha-label"
              {...describedBy('captcha', 'captcha-hint')}
              className="rounded-lg"
            >
              <TurnstileWidget ref={turnstileRef} onToken={handleCaptchaToken} />
            </div>
            <p id="captcha-hint" className="hint">
              Keeps automated spam out. It usually completes on its own.
            </p>
            <FieldError id="captcha-error" message={errors.captcha} />
          </div>

          <div className="mt-7">
            <button
              type="submit"
              disabled={submitDisabled}
              aria-describedby="submit-hint"
              className="btn-primary min-h-[56px] w-full gap-2.5 text-lg font-extrabold"
            >
              {submitting ? (
                <>
                  <Loader2 {...ICON} className="animate-spin" />
                  Sending report…
                </>
              ) : (
                <>
                  Send report
                  <ArrowRight size={20} strokeWidth={2.5} aria-hidden="true" />
                </>
              )}
            </button>
            <p id="submit-hint" aria-live="polite" className="hint text-center empty:hidden">
              {photosBusy
                ? 'Waiting for your photos to finish uploading…'
                : !captchaToken
                  ? 'The security check must finish before you can send the report.'
                  : ''}
            </p>

            {/* Form-level status, announced to screen readers */}
            <div aria-live="assertive" role="alert">
              {formError && (
                <div className="mt-4 flex animate-rise-in items-start gap-3 rounded-md border border-l-4 border-hazard-100 border-l-hazard-500 bg-hazard-50 px-4 py-3 text-sm font-semibold leading-snug text-ink">
                  <AlertTriangle
                    {...ICON}
                    className="mt-px shrink-0 text-hazard-600"
                  />
                  <span>{formError}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
