/**
 * Add a place by hand, edit a manual one, or look at an imported one, in a
 * side drawer (full screen on phones), like the team panel.
 *
 * OpenStreetMap places are read-only here: their name, category and shape come
 * from the monthly import (ADR 0004). Staff can only disable them, from the list.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Info, Loader2, X } from 'lucide-react'
import { createPlace, updatePlace } from '../api.js'
import BaseLocationPicker from '../admin/BaseLocationPicker.jsx'
import { InlineError, describeError } from '../admin/feedback.jsx'
import { SHAPE_LABELS, categoryLabel, categoryOptionLabel, pointOf } from './format.js'
import { CategoryTag, SourceTag } from './PlaceRow.jsx'

const NAME_MAX = 200
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const ERROR_MESSAGES = {
  place_not_found: 'This place no longer exists. Reload the page.',
  unknown_category: 'That category is not recognised. Reload the page and try again.',
  osm_place_read_only: 'Places from OpenStreetMap can only be enabled or disabled.',
}

function validate(form) {
  const errors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give the place a name, so staff recognise it.'
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`
  if (!form.category) errors.category = 'Choose a category; it sets how much the place raises priority.'
  if (!form.location) errors.location = 'Set where the place is on the map.'
  return errors
}

/**
 * @param {{
 *   place: import('../api.js').Place | null,   null to add a new place
 *   categories: import('../api.js').PlaceCategory[],
 *   colourOf: (category: string) => string,
 *   onClose: () => void,
 *   onSaved: (place: import('../api.js').Place, created: boolean) => void,
 * }} props
 */
export default function PlacePanel({ place, categories, colourOf, onClose, onSaved }) {
  const id = useId()
  const panelRef = useRef(null)
  const firstRef = useRef(null)
  const creating = !place
  const readOnly = place?.source === 'osm'
  const [form, setForm] = useState(() => ({
    name: place?.name ?? '',
    category: place?.category ?? '',
    location: pointOf(place?.geometry),
  }))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const opener = document.activeElement
    firstRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
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

  /** Only what changed (the API is a partial update). */
  function changes() {
    const name = form.name.trim()
    const loc = form.location
    if (creating) return { name, category: form.category, location: { lat: loc.lat, lng: loc.lng } }
    const body = {}
    if (name !== (place.name ?? '')) body.name = name
    if (form.category !== place.category) body.category = form.category
    const before = pointOf(place.geometry)
    if (!before || before.lat !== loc.lat || before.lng !== loc.lng) body.location = { lat: loc.lat, lng: loc.lng }
    return body
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) {
      const first = ['name', 'category', 'location'].find((f) => found[f])
      panelRef.current?.querySelector(`[data-field="${first}"]`)?.focus()
      return
    }
    const body = changes()
    if (!creating && !Object.keys(body).length) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const saved = creating ? await createPlace(body) : await updatePlace(place.id, body)
      onSaved(saved, creating)
    } catch (error) {
      setFormError(describeError(error, ERROR_MESSAGES))
    } finally {
      setSaving(false)
    }
  }

  const titleId = `${id}-title`
  const err = (field) => (errors[field] ? `${id}-${field}-error` : undefined)
  const title = creating ? 'Add a place' : readOnly ? place.name || 'Unnamed place' : `Edit ${place.name || 'place'}`
  // Categories the backend knows, plus the place's own if it's not among them.
  const options =
    place && !categories.some((c) => c.id === place.category)
      ? [...categories, { id: place.category, weight: undefined }]
      : categories

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
          <h2 id={titleId} className="truncate text-lg font-extrabold">
            {title}
          </h2>
          <button
            ref={readOnly ? firstRef : undefined}
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-concrete-100"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={20} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </header>

        {readOnly ? (
          <OsmDetails place={place} colour={colourOf(place.category)} weight={categories.find((c) => c.id === place.category)?.weight} onClose={onClose} />
        ) : (
          <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
              <div>
                <label htmlFor={`${id}-name`} className="label">
                  Name
                </label>
                <input
                  ref={firstRef}
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

              <div>
                <label htmlFor={`${id}-category`} className="label">
                  Category
                </label>
                <select
                  id={`${id}-category`}
                  data-field="category"
                  className="input"
                  value={form.category}
                  aria-invalid={errors.category ? 'true' : undefined}
                  aria-describedby={`${id}-category-hint ${err('category') ?? ''}`.trim()}
                  onChange={(e) => set('category', e.target.value)}
                >
                  <option value="">Choose a category</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.weight === undefined ? categoryLabel(c.id) : categoryOptionLabel(c)}
                    </option>
                  ))}
                </select>
                <p id={`${id}-category-hint`} className="hint">
                  The weight is how strongly the place raises the priority of incidents within 300 m.
                </p>
                <InlineError id={err('category')}>{errors.category}</InlineError>
              </div>

              <fieldset>
                <legend className="label">Location</legend>
                <div data-field="location" tabIndex={-1}>
                  <BaseLocationPicker
                    value={form.location}
                    onChange={(point) => set('location', point)}
                    invalid={Boolean(errors.location)}
                    describedBy={err('location')}
                  />
                </div>
                <InlineError id={err('location')}>{errors.location}</InlineError>
              </fieldset>

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
                {creating ? 'Add place' : 'Save changes'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  )
}

/** Read-only facts about an imported place. */
function OsmDetails({ place, colour, weight, onClose }) {
  const point = pointOf(place.geometry)
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        <p className="flex items-start gap-2 rounded-md border-2 border-dashed border-ink bg-white px-3 py-2.5">
          <Info size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            This place comes from OpenStreetMap. Its name, category and shape are read-only here and are refreshed by each
            monthly import; fix mistakes in OpenStreetMap itself. You can still disable it from the list.
          </span>
        </p>
        <dl className="divide-y divide-concrete-200 rounded-md border border-concrete-300 bg-white">
          <Fact label="Name">{place.name || <span className="italic text-asphalt-500">Unnamed</span>}</Fact>
          <Fact label="Category">
            <CategoryTag category={place.category} colour={colour} />
            {weight !== undefined && <span className="ml-2 font-mono text-xs text-asphalt-600">weight {weight}</span>}
          </Fact>
          <Fact label="Source">
            <SourceTag place={place} />
          </Fact>
          <Fact label="Shape">
            {SHAPE_LABELS[place.geometry.type] ?? place.geometry.type}
            {point && (
              <span className="readout ml-2">
                <span className="text-asphalt-400">LAT</span>
                {point.lat.toFixed(5)}
                <span className="ml-1 text-asphalt-400">LNG</span>
                {point.lng.toFixed(5)}
              </span>
            )}
          </Fact>
          <Fact label="Status">{place.enabled ? 'Enabled' : 'Disabled (stays disabled after imports)'}</Fact>
        </dl>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-concrete-300 bg-white px-4 py-3">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </footer>
    </>
  )
}

function Fact({ label, children }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 px-3 py-2.5">
      <dt className="text-[11px] font-extrabold uppercase tracking-sign text-asphalt-600">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
