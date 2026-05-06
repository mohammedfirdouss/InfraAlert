import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  MapPin,
  Phone,
  Image,
  FileText,
  CheckCircle2,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { submitReport } from '../api/client.js'

const ISSUE_TYPES = [
  { value: 'pothole', label: 'Pothole' },
  { value: 'water_leak', label: 'Water Leak' },
  { value: 'power_outage', label: 'Power Outage' },
  { value: 'broken_streetlight', label: 'Broken Streetlight' },
  { value: 'sewage', label: 'Sewage Issue' },
  { value: 'road_damage', label: 'Road Damage' },
  { value: 'other', label: 'Other' },
]

const INITIAL_FORM = {
  issue_type: '',
  location: '',
  description: '',
  citizen_phone: '',
  image_url: '',
}

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

export default function ReportForm() {
  const navigate = useNavigate()
  const [form, setForm] = useState(INITIAL_FORM)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)
  const [apiError, setApiError] = useState(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    // Clear field error on change
    if (errors[name]) {
      setErrors((e) => ({ ...e, [name]: undefined }))
    }
  }

  function validate() {
    const errs = {}
    if (!form.location.trim() || form.location.trim().length < 3) {
      errs.location = 'Please enter a valid location (at least 3 characters).'
    }
    if (!form.description.trim() || form.description.trim().length < 10) {
      errs.description = 'Please describe the issue in at least 10 characters.'
    }
    if (
      form.citizen_phone &&
      !/^\+?[\d\s\-().]{7,20}$/.test(form.citizen_phone.trim())
    ) {
      errs.citizen_phone = 'Please enter a valid phone number.'
    }
    if (form.image_url && !/^https?:\/\/.+/.test(form.image_url.trim())) {
      errs.image_url = 'Please enter a valid URL starting with http:// or https://'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setApiError(null)

    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        issue_type: form.issue_type || 'other',
        location: form.location.trim(),
        description: form.description.trim(),
        citizen_phone: form.citizen_phone.trim(),
        media_urls: form.image_url.trim() ? [form.image_url.trim()] : [],
      }
      const result = await submitReport(payload)
      setSubmitted(result)
    } catch (err) {
      setApiError(err.message || 'Failed to submit report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Success screen
  if (submitted) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="card p-8 space-y-5">
          <div className="flex justify-center">
            <div className="p-4 bg-green-50 rounded-full">
              <CheckCircle2 size={40} className="text-green-500" />
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Report Submitted!</h2>
            <p className="mt-2 text-sm text-gray-500">
              Your issue has been received and AI agents are analyzing it now.
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Report ID</span>
              <span className="font-mono font-semibold text-gray-900">{submitted.report_id}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Location</span>
              <span className="text-gray-900 text-right max-w-[60%]">{submitted.location}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Status</span>
              <span className="capitalize text-gray-900">{submitted.status}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => navigate(`/reports/${submitted.report_id}`)}
              className="btn-primary w-full"
            >
              Track Report Status
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                setSubmitted(null)
                setForm(INITIAL_FORM)
              }}
              className="btn-secondary w-full"
            >
              Submit Another Report
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-primary-600 rounded-lg">
            <AlertTriangle size={16} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Report an Issue</h1>
        </div>
        <p className="text-sm text-gray-500">
          Fill in the details below. Our AI system will analyze and dispatch the right team.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="card p-6 space-y-5">
        {/* Issue type */}
        <div>
          <label htmlFor="issue_type" className="label">
            Issue Type
          </label>
          <select
            id="issue_type"
            name="issue_type"
            value={form.issue_type}
            onChange={handleChange}
            className="input"
          >
            <option value="">Select issue type…</option>
            {ISSUE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div>
          <label htmlFor="location" className="label">
            Location <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <MapPin
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              id="location"
              name="location"
              value={form.location}
              onChange={handleChange}
              placeholder="Enter street address or landmark"
              className={`input pl-9 ${errors.location ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
              autoComplete="street-address"
            />
          </div>
          <FieldError message={errors.location} />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="label">
            Description <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <FileText
              size={15}
              className="absolute left-3 top-3 text-gray-400 pointer-events-none"
            />
            <textarea
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              placeholder="Describe the issue in detail — size, severity, how long it's been there, any safety risks…"
              className={`input pl-9 resize-none ${errors.description ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
            />
          </div>
          <div className="flex justify-between">
            <FieldError message={errors.description} />
            <span className="text-xs text-gray-400 mt-1 ml-auto">
              {form.description.length} chars
            </span>
          </div>
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="citizen_phone" className="label">
            Phone Number{' '}
            <span className="text-gray-400 font-normal">(optional — for SMS updates)</span>
          </label>
          <div className="relative">
            <Phone
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="tel"
              id="citizen_phone"
              name="citizen_phone"
              value={form.citizen_phone}
              onChange={handleChange}
              placeholder="+254 7XX XXX XXX"
              className={`input pl-9 ${errors.citizen_phone ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
              autoComplete="tel"
            />
          </div>
          <FieldError message={errors.citizen_phone} />
        </div>

        {/* Image URL */}
        <div>
          <label htmlFor="image_url" className="label">
            Photo URL{' '}
            <span className="text-gray-400 font-normal">(optional — link to uploaded photo)</span>
          </label>
          <div className="relative">
            <Image
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="url"
              id="image_url"
              name="image_url"
              value={form.image_url}
              onChange={handleChange}
              placeholder="https://example.com/photo.jpg"
              className={`input pl-9 ${errors.image_url ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
            />
          </div>
          <FieldError message={errors.image_url} />
        </div>

        {/* API error */}
        {apiError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {apiError}
          </div>
        )}

        {/* Submit */}
        <div className="pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-2.5 text-base"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <AlertTriangle size={18} />
                Submit Report
              </>
            )}
          </button>
          <p className="mt-3 text-xs text-center text-gray-400">
            Reports are processed by AI agents within minutes. Emergency? Call{' '}
            <span className="font-semibold text-gray-600">112</span>.
          </p>
        </div>
      </form>
    </div>
  )
}
