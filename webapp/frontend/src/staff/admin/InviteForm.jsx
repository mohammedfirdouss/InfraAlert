/**
 * Invite a colleague by email (ADR 0007). No email is sent: the invitation
 * becomes active the first time they sign in with that address.
 */
import { useId, useRef, useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { inviteMember } from '../api.js'
import { ROLE_LABELS } from '../ui.jsx'
import { InlineError, describeError } from './feedback.jsx'

// Deliberately loose, like the backend: the identity provider is the real check.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const FIRST_SIGN_IN_NOTE =
  "They'll get access the first time they sign in with this email through the city account."

/** @param {{ onInvited: (member: import('../api.js').Member) => void }} props */
export default function InviteForm({ onInvited }) {
  const id = useId()
  const emailRef = useRef(null)
  const nameRef = useRef(null)
  const [form, setForm] = useState({ email: '', display_name: '', role: 'dispatcher' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [invited, setInvited] = useState(/** @type {import('../api.js').Member | null} */ (null))
  const [saving, setSaving] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    const email = form.email.trim()
    const display_name = form.display_name.trim()
    const found = {}
    if (!email) found.email = 'Enter their work email address.'
    else if (!EMAIL.test(email)) found.email = 'That doesn’t look like an email address.'
    if (!display_name) found.display_name = 'Enter their name, as colleagues will see it.'
    setErrors(found)
    if (found.email) return emailRef.current?.focus()
    if (found.display_name) return nameRef.current?.focus()

    setSaving(true)
    try {
      const member = await inviteMember({ email, display_name, role: form.role })
      setInvited(member)
      setForm({ email: '', display_name: '', role: form.role })
      onInvited(member)
    } catch (error) {
      if (error?.detail === 'already_staff') {
        setErrors({ email: 'This email already belongs to someone on the staff list.' })
        emailRef.current?.focus()
      } else {
        setFormError(describeError(error))
      }
    } finally {
      setSaving(false)
    }
  }

  const err = (field) => (errors[field] ? `${id}-${field}-error` : undefined)

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby={`${id}-title`} className="rounded-lg border border-concrete-300 bg-white p-4">
      <h2 id={`${id}-title`} className="section-title mb-3">
        Invite staff
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_10rem_auto] xl:items-start">
        <div>
          <label htmlFor={`${id}-email`} className="label">
            Email
          </label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            className="input"
            autoComplete="off"
            value={form.email}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={err('email')}
            onChange={(e) => set('email', e.target.value)}
          />
          <InlineError id={err('email')}>{errors.email}</InlineError>
        </div>
        <div>
          <label htmlFor={`${id}-name`} className="label">
            Display name
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            className="input"
            autoComplete="off"
            value={form.display_name}
            aria-invalid={errors.display_name ? 'true' : undefined}
            aria-describedby={err('display_name')}
            onChange={(e) => set('display_name', e.target.value)}
          />
          <InlineError id={err('display_name')}>{errors.display_name}</InlineError>
        </div>
        <div>
          <label htmlFor={`${id}-role`} className="label">
            Role
          </label>
          <select id={`${id}-role`} className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="xl:pt-[1.625rem]">
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus size={16} strokeWidth={2.5} aria-hidden="true" />
            )}
            Invite
          </button>
        </div>
      </div>
      <div aria-live="polite">
        <InlineError>{formError}</InlineError>
        {invited && !formError && (
          <p className="mt-3 animate-rise-in rounded-md border border-go-600 bg-go-50 px-3 py-2 text-sm text-go-700">
            <strong>{invited.display_name}</strong> ({invited.email}) is invited. {FIRST_SIGN_IN_NOTE}
          </p>
        )}
      </div>
      {!invited && <p className="hint">No email is sent. People you invite get access the first time they sign in with that email through the city account.</p>}
    </form>
  )
}
