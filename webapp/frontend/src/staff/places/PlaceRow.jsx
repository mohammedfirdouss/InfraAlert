/**
 * One sensitive place in the list: name, category, source and an Enabled
 * switch. Disabling asks first, inline, and says what it changes.
 */
import { memo, useState } from 'react'
import { Eye, Loader2, Pencil } from 'lucide-react'
import { InlineError } from '../admin/feedback.jsx'
import { categoryLabel } from './format.js'

export const PLACE_COLS =
  'md:grid md:grid-cols-[minmax(10rem,2fr)_minmax(7rem,1fr)_minmax(8rem,1.2fr)_6.5rem_5rem] md:items-center md:gap-3'

/** @param {{ place: import('../api.js').Place }} props */
export function SourceTag({ place }) {
  if (place.source === 'osm') {
    return (
      <span className="tag gap-1.5" title="Imported from OpenStreetMap">
        <span className="font-extrabold">OSM</span>
        {place.osm_id && <span className="font-mono text-[11px] text-asphalt-600">{place.osm_id}</span>}
      </span>
    )
  }
  return (
    <span className="tag border-ink bg-signal-100" title="Added by staff">
      Manual
    </span>
  )
}

/** @param {{ category: string, colour: string }} props */
export function CategoryTag({ category, colour }) {
  return (
    <span className="tag">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-ink" style={{ backgroundColor: colour }} />
      {categoryLabel(category)}
    </span>
  )
}

/** The Enabled switch, styled like the team panel's Active switch. */
function EnabledSwitch({ checked, disabled, label, onChange }) {
  return (
    <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full border-2 border-ink bg-concrete-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:bg-signal-400 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:opacity-50"
      />
      <span className="text-[13px] font-bold md:sr-only" aria-hidden="true">
        {checked ? 'Enabled' : 'Disabled'}
      </span>
    </label>
  )
}

/**
 * @param {{
 *   place: import('../api.js').Place,
 *   colour: string,
 *   highlighted: boolean,
 *   canEdit: boolean,
 *   onHover: (id: string | null) => void,
 *   onOpen: (place: import('../api.js').Place) => void,
 *   onSetEnabled: (place: import('../api.js').Place, enabled: boolean) => Promise<void>,
 * }} props
 */
function PlaceRow({ place, colour, highlighted, canEdit, onHover, onOpen, onSetEnabled }) {
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const name = place.name || 'Unnamed'
  const manual = place.source === 'manual'

  async function save(enabled) {
    setSaving(true)
    setError('')
    try {
      await onSetEnabled(place, enabled)
      setConfirming(false)
    } catch (e) {
      setError(e?.message || 'We couldn’t save that. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleSwitch(enabled) {
    if (enabled) save(true)
    else setConfirming(true)
  }

  return (
    <li
      id={`place-row-${place.id}`}
      tabIndex={-1}
      aria-label={name}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      className={`relative px-4 py-2.5 transition-colors focus:outline-none ${highlighted ? 'bg-signal-100' : ''}`}
    >
      {highlighted && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-signal-400" />}
      <div className={`grid gap-1.5 ${PLACE_COLS} ${place.enabled ? '' : 'text-asphalt-500'}`}>
        <span className={`font-bold ${place.name ? 'text-ink' : 'italic text-asphalt-500'} ${place.enabled ? '' : 'line-through decoration-asphalt-400'}`}>
          {name}
        </span>
        <span>
          <CategoryTag category={place.category} colour={colour} />
        </span>
        <span>
          <SourceTag place={place} />
        </span>
        <span className="flex items-center gap-2">
          <EnabledSwitch
            checked={place.enabled}
            disabled={!canEdit || saving || confirming}
            label={`${name} enabled`}
            onChange={handleSwitch}
          />
          {saving && <Loader2 size={14} className="animate-spin" aria-label="Saving" />}
        </span>
        <span className="md:text-right">
          {canEdit && (
          <button
            type="button"
            className="btn-ghost -mx-3 text-sm"
            onClick={() => onOpen(place)}
            aria-label={manual ? `Edit ${name}` : `Details for ${name}`}
          >
            {manual ? (
              <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Eye size={14} strokeWidth={2.5} aria-hidden="true" />
            )}
            {manual ? 'Edit' : 'Details'}
          </button>
          )}
        </span>
      </div>

      {confirming && (
        <div
          role="group"
          aria-label={`Disable ${name}?`}
          className="mt-2 animate-rise-in rounded-md border-2 border-ink bg-white p-3"
        >
          <p className="font-bold">Disable {name}?</p>
          <p className="mt-1 text-asphalt-600">
            Incidents near it will no longer get its priority bonus.
            {place.source === 'osm' &&
              ' It stays disabled after future OpenStreetMap imports, until someone here enables it again.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-danger" disabled={saving} onClick={() => save(false)}>
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              Disable place
            </button>
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setConfirming(false)}>
              Keep enabled
            </button>
          </div>
        </div>
      )}
      <InlineError>{error}</InlineError>
    </li>
  )
}

export default memo(PlaceRow)
