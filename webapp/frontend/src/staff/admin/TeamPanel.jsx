/**
 * Create or edit a team, in a side drawer (full screen on phones).
 * Edits send only the fields that changed (the API is a partial update).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { createTeam, updateTeam } from '../api.js'
import { ISSUE_TYPES } from '../ui.jsx'
import BaseLocationPicker from './BaseLocationPicker.jsx'
import { InlineError, describeError } from './feedback.jsx'

const NAME_MAX = 100
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** @param {import('../api.js').Team | null} team */
function initialForm(team) {
  return {
    name: team?.name ?? '',
    skills: team?.skills ?? [],
    base_location: team?.base_location ?? null,
    active: team?.active ?? true,
  }
}

function validate(form) {
  const errors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give the team a name.'
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`
  if (!form.skills.length) errors.skills = 'Pick at least one skill, so the team can be suggested for incidents.'
  if (!form.base_location) errors.base_location = "Set the team's base on the map."
  return errors
}

const sameSkills = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * @param {{
 *   team: import('../api.js').Team | null,   null to create a new team
 *   onClose: () => void,
 *   onSaved: (team: import('../api.js').Team, warning: string | null) => void,
 * }} props
 */
export default function TeamPanel({ team, onClose, onSaved }) {
  const id = useId()
  const panelRef = useRef(null)
  const nameRef = useRef(null)
  const [form, setForm] = useState(() => initialForm(team))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const editing = Boolean(team)

  useEffect(() => {
    const opener = document.activeElement
    nameRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function toggleSkill(value) {
    set(
      'skills',
      form.skills.includes(value) ? form.skills.filter((s) => s !== value) : [...form.skills, value],
    )
  }

  /** Escape closes; Tab stays inside the drawer while it's open. */
  function handleKeyDown(event) {
    if (event.key === 'Escape' && !saving) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function changes() {
    const body = {}
    const name = form.name.trim()
    if (!editing || name !== team.name) body.name = name
    if (!editing || !sameSkills(form.skills, team.skills)) {
      // Keep the canonical ISSUE_TYPES order.
      body.skills = ISSUE_TYPES.map((t) => t.value).filter((v) => form.skills.includes(v))
    }
    const loc = form.base_location
    if (!editing || loc.lat !== team.base_location.lat || loc.lng !== team.base_location.lng) {
      body.base_location = { lat: loc.lat, lng: loc.lng }
    }
    if (!editing || form.active !== team.active) body.active = form.active
    return body
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) {
      const first = ['name', 'skills', 'base_location'].find((f) => found[f])
      panelRef.current?.querySelector(`[data-field="${first}"]`)?.focus()
      return
    }
    const body = changes()
    if (editing && !Object.keys(body).length) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const saved = editing ? await updateTeam(team.id, body) : await createTeam(body)
      const { warning = null, ...rest } = saved ?? {}
      onSaved(rest, warning)
    } catch (error) {
      if (error?.detail === 'team_name_taken') {
        setErrors({
          name: `Another team is already called “${form.name.trim()}”. Team names must be unique (capital letters don't count).`,
        })
        nameRef.current?.focus()
      } else {
        setFormError(describeError(error, { team_not_found: 'This team no longer exists. Reload the page.' }))
      }
    } finally {
      setSaving(false)
    }
  }

  const titleId = `${id}-title`
  const err = (field) => (errors[field] ? `${id}-${field}-error` : undefined)

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end" onKeyDown={handleKeyDown}>
      <div className="absolute inset-0 hidden bg-ink/40 sm:block" aria-hidden="true" onClick={saving ? undefined : onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full animate-rise-in flex-col bg-concrete-50 shadow-lift sm:w-[30rem] sm:border-l-2 sm:border-ink"
      >
        <header className="flex items-center justify-between gap-2 border-b border-concrete-300 bg-white px-4 py-2">
          <h2 id={titleId} className="text-lg font-extrabold">
            {editing ? `Edit ${team.name}` : 'New team'}
          </h2>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-concrete-100"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </header>

        <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
            <div>
              <label htmlFor={`${id}-name`} className="label">
                Name
              </label>
              <input
                ref={nameRef}
                id={`${id}-name`}
                data-field="name"
                className="input"
                value={form.name}
                maxLength={NAME_MAX + 20}
                autoComplete="off"
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={err('name')}
                onChange={(e) => set('name', e.target.value)}
              />
              <InlineError id={err('name')}>{errors.name}</InlineError>
            </div>

            <fieldset aria-describedby={err('skills')}>
              <legend className="label">Skills</legend>
              <p className="hint mb-2 mt-0">The issue types this team can fix.</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {ISSUE_TYPES.map(({ value, label, Icon }, index) => {
                  const checked = form.skills.includes(value)
                  return (
                    <label
                      key={value}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border-2 px-2.5 py-1.5 font-semibold ${
                        checked ? 'border-ink bg-signal-100' : 'border-concrete-300 bg-white hover:border-concrete-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ink"
                        data-field={index === 0 ? 'skills' : undefined}
                        checked={checked}
                        onChange={() => toggleSkill(value)}
                      />
                      <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
                      {label}
                    </label>
                  )
                })}
              </div>
              <InlineError id={err('skills')}>{errors.skills}</InlineError>
            </fieldset>

            <fieldset>
              <legend className="label">Base location</legend>
              <div data-field="base_location" tabIndex={-1}>
                <BaseLocationPicker
                  value={form.base_location}
                  onChange={(point) => set('base_location', point)}
                  invalid={Boolean(errors.base_location)}
                  describedBy={err('base_location')}
                />
              </div>
              <InlineError id={err('base_location')}>{errors.base_location}</InlineError>
            </fieldset>

            <div>
              <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-md border-2 border-concrete-300 bg-white px-3 py-2">
                <span>
                  <span className="block font-bold">Active</span>
                  <span className="block text-[13px] text-asphalt-500">
                    Inactive teams are never suggested or assigned.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="peer sr-only"
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                <span
                  aria-hidden="true"
                  className="relative h-6 w-11 shrink-0 rounded-full border-2 border-ink bg-concrete-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:bg-signal-400 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
                />
              </label>
            </div>

            <div aria-live="polite">
              <InlineError>{formError}</InlineError>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-concrete-300 bg-white px-4 py-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {editing ? 'Save changes' : 'Create team'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
