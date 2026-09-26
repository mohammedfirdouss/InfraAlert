/**
 * Sensitive places (admin): hospitals, schools, major roads and the like,
 * whose nearness raises an incident's priority (CONTEXT.md, ADR 0004). Most
 * come from a monthly OpenStreetMap import; admins can add places by hand and
 * disable any place (disabled OSM places stay disabled across imports).
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { List, Map as MapIcon, Plus } from 'lucide-react'
import { getPlaces, updatePlace } from '../api.js'
import { useStaff } from '../auth.jsx'
import { formatDateTime, hasRole } from '../ui.jsx'
import { EmptyState, LoadError, SkeletonRows, Toasts, describeError, useToasts } from '../admin/feedback.jsx'
import PlaceFilters from '../places/PlaceFilters.jsx'
import PlacePanel from '../places/PlacePanel.jsx'
import PlaceRow, { PLACE_COLS } from '../places/PlaceRow.jsx'
import PlacesMap from '../places/PlacesMap.jsx'
import { NO_FILTERS, categoryColour, filterPlaces, sortPlaces } from '../places/format.js'

/** Rows rendered per "Show more": enough to scan, few enough to stay fast. */
export const PAGE_SIZE = 200

export default function Places() {
  const staff = useStaff()?.staff ?? null
  const canEdit = hasRole(staff, 'admin')

  const [data, setData] = useState(
    /** @type {{ places: import('../api.js').Place[], categories: import('../api.js').PlaceCategory[], last_import_at: string | null } | null} */ (null),
  )
  const [loadError, setLoadError] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [hoveredId, setHoveredId] = useState(/** @type {string | null} */ (null))
  const [selected, setSelected] = useState(/** @type {{ id: string } | null} */ (null))
  // undefined: closed; null: adding; a place: editing or viewing it.
  const [editing, setEditing] = useState(/** @type {import('../api.js').Place | null | undefined} */ (undefined))
  const [view, setView] = useState(/** @type {'list' | 'map'} */ ('list'))
  const { toasts, notify, dismiss } = useToasts()

  const load = useCallback(() => {
    setLoadError('')
    setData(null)
    getPlaces()
      .then((body) => setData({ places: body.places ?? [], categories: body.categories ?? [], last_import_at: body.last_import_at ?? null }))
      .catch((error) => setLoadError(describeError(error)))
  }, [])

  useEffect(load, [load])

  const places = useMemo(() => (data ? sortPlaces(data.places) : null), [data])
  const categories = data?.categories ?? []
  // Filtering thousands of places on each keystroke: let typing win.
  const deferredFilters = useDeferredValue(filters)
  const filtered = useMemo(() => (places ? filterPlaces(places, deferredFilters) : null), [places, deferredFilters])
  const shown = useMemo(() => filtered?.slice(0, limit) ?? [], [filtered, limit])

  const categoryIds = useMemo(() => {
    const ids = categories.map((c) => c.id)
    for (const p of places ?? []) if (!ids.includes(p.category)) ids.push(p.category)
    return ids
  }, [categories, places])
  const colourOf = useCallback((category) => categoryColour(category, categoryIds), [categoryIds])

  function changeFilters(next) {
    setFilters(next)
    setLimit(PAGE_SIZE)
  }

  /** A map feature was clicked: show its row (paging it in if needed) and focus it. */
  const selectFromMap = useCallback(
    (id) => {
      const index = filtered?.findIndex((p) => p.id === id) ?? -1
      if (index >= limit) setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE)
      setView('list')
      setSelected({ id })
    },
    [filtered, limit],
  )

  useEffect(() => {
    if (!selected) return
    const row = document.getElementById(`place-row-${selected.id}`)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    row?.focus()
  }, [selected])

  const replacePlace = useCallback((saved) => {
    setData((d) => d && { ...d, places: d.places.map((p) => (p.id === saved.id ? saved : p)) })
  }, [])

  const setEnabled = useCallback(
    async (place, enabled) => {
      try {
        const saved = await updatePlace(place.id, { enabled })
        replacePlace({ ...place, ...saved, enabled: saved?.enabled ?? enabled })
        const name = place.name || 'Unnamed place'
        notify(enabled ? `“${name}” enabled.` : `“${name}” disabled. Nearby incidents no longer get its bonus.`)
      } catch (error) {
        throw new Error(describeError(error, { place_not_found: 'This place no longer exists. Reload the page.' }))
      }
    },
    [notify, replacePlace],
  )

  function handleSaved(saved, created) {
    if (created) setData((d) => d && { ...d, places: [...d.places, saved] })
    else replacePlace(saved)
    setEditing(undefined)
    notify(created ? `“${saved.name}” added.` : `Changes to “${saved.name}” saved.`)
    if (created) setSelected({ id: saved.id })
  }

  const highlightedId = hoveredId ?? selected?.id ?? null
  const total = places?.length ?? 0

  let content
  if (loadError) {
    content = <LoadError message={`We couldn't load the places. ${loadError}`} onRetry={load} />
  } else if (!filtered) {
    content = <SkeletonRows label="Loading places" />
  } else if (total === 0) {
    content = (
      <EmptyState title="No sensitive places yet">
        They arrive with the first OpenStreetMap import. You can also add one with “Add place”.
      </EmptyState>
    )
  } else if (filtered.length === 0) {
    content = (
      <EmptyState title="No places match these filters">
        <button type="button" className="font-bold text-ink underline" onClick={() => changeFilters(NO_FILTERS)}>
          Clear the filters
        </button>
      </EmptyState>
    )
  } else {
    content = (
      <>
        <ul className="divide-y divide-concrete-200">
          {shown.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              colour={colourOf(place.category)}
              highlighted={highlightedId === place.id}
              onHover={setHoveredId}
              onOpen={setEditing}
              onSetEnabled={setEnabled}
            />
          ))}
        </ul>
        {filtered.length > shown.length && (
          <div className="flex items-center justify-between gap-3 border-t border-concrete-300 px-4 py-3">
            <span className="text-asphalt-500">
              Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
            </span>
            <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
              Show more
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="space-y-4 p-4 text-sm lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Sensitive places</h1>
          <p className="text-asphalt-500">
            Incidents within 300 m of a sensitive place get a priority bonus, weighted by its category.
          </p>
          <LastImport data={data} />
        </div>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setEditing(null)} disabled={!data}>
            <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
            Add place
          </button>
        )}
      </header>

      {data && <PlaceFilters filters={filters} categories={categories} onChange={changeFilters} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {filtered && total > 0 && (
          <p className="text-asphalt-600" aria-live="polite">
            {filtered.length === total
              ? `${total.toLocaleString()} ${total === 1 ? 'place' : 'places'}`
              : `${filtered.length.toLocaleString()} of ${total.toLocaleString()} places match`}
          </p>
        )}
        <div role="group" aria-label="Show" className="ml-auto inline-flex rounded-md border-2 border-ink lg:hidden">
          {[
            { value: 'list', label: 'List', Icon: List },
            { value: 'map', label: 'Map', Icon: MapIcon },
          ].map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(/** @type {'list' | 'map'} */ (value))}
              className={`inline-flex min-h-[44px] items-center gap-1.5 px-4 text-sm font-bold ${
                view === value ? 'bg-ink text-signal-300' : 'bg-white text-ink'
              }`}
            >
              <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:items-start lg:gap-4">
        <section
          aria-label="Place list"
          data-testid="places-list-pane"
          className={`overflow-hidden rounded-lg border border-concrete-300 bg-white ${view === 'map' ? 'hidden lg:block' : ''}`}
        >
          <div
            aria-hidden="true"
            className={`hidden border-b border-concrete-300 bg-concrete-100 px-4 py-2 text-[11px] font-extrabold uppercase tracking-sign text-asphalt-600 ${PLACE_COLS}`}
          >
            <span>Place</span>
            <span>Category</span>
            <span>Source</span>
            <span>Enabled</span>
            <span className="sr-only">Actions</span>
          </div>
          {content}
        </section>

        <div
          data-testid="places-map-pane"
          className={`h-[70vh] lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] ${view === 'list' ? 'hidden' : ''}`}
        >
          <PlacesMap
            places={filtered}
            allPlaces={places}
            categoryIds={categoryIds}
            highlightedId={highlightedId}
            onHover={setHoveredId}
            onSelect={selectFromMap}
            visible={view === 'map'}
            className="h-full w-full"
          />
        </div>
      </div>

      {canEdit && editing !== undefined && data && (
        <PlacePanel
          key={editing?.id ?? 'new'}
          place={editing}
          categories={categories}
          colourOf={colourOf}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
        />
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  )
}

/** "Last OpenStreetMap import: 1 Sep 2026, 03:00", or how imports happen when there hasn't been one. */
function LastImport({ data }) {
  if (!data) return null
  if (data.last_import_at) {
    return (
      <p className="mt-1 text-asphalt-600">
        Last OpenStreetMap import: <span className="font-bold text-ink">{formatDateTime(data.last_import_at)}</span>
      </p>
    )
  }
  return (
    <p className="mt-1 text-asphalt-600">
      Last OpenStreetMap import: <span className="font-bold text-ink">never</span>. The monthly import runs
      automatically; to run it now, use <code className="font-mono text-xs">python -m infraalert.cli import-osm</code>.
    </p>
  )
}
