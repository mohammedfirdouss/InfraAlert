import { useEffect, useId, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { Loader2, LocateFixed, MapPin, Search } from 'lucide-react'
import { config } from '../config.js'
import {
  addressSearchEnabled,
  markerIcon,
  reverseGeocode,
  searchAddress,
  tileLayer,
} from '../map.js'

const LOCATED_ZOOM = 17
const SEARCH_DEBOUNCE_MS = 300
const GEOLOCATION_TIMEOUT_MS = 10000

const GEOLOCATION_ERRORS = {
  1: 'Location access was denied. You can allow it in your browser settings, or tap the map to place the pin.',
  2: "We couldn't work out your location. Try again outdoors, or tap the map to place the pin.",
  3: 'Finding your location took too long. Try again, or tap the map to place the pin.',
}

/** Hands the Leaflet map instance to the parent and forwards map clicks. */
function MapBridge({ mapRef, onMapClick }) {
  mapRef.current = useMap()
  useMapEvents({
    click(event) {
      onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

/**
 * LocationPicker: the citizen chooses where the problem is (ADR 0003, decision Q5).
 * Every report must carry coordinates; the address is display-only, so it is
 * reported separately through `onAddressChange` (null when unknown).
 *
 * @param {{
 *   value: { lat: number, lng: number } | null,
 *   onChange: (point: { lat: number, lng: number }) => void,
 *   onAddressChange: (address: string | null) => void,
 * }} props
 */
export default function LocationPicker({ value, onChange, onAddressChange }) {
  const mapRef = useRef(null)
  const reverseAbortRef = useRef(null)
  const geolocationSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator

  const [locating, setLocating] = useState(false)
  const [status, setStatus] = useState('')

  // Abort any in-flight reverse geocode when the picker goes away.
  useEffect(() => () => reverseAbortRef.current?.abort(), [])

  /** Sets the point, then looks up its address (or uses the one we already know). */
  function commitPoint(point, { recenter = false, address } = {}) {
    reverseAbortRef.current?.abort()
    reverseAbortRef.current = null
    onChange(point)
    if (recenter) mapRef.current?.setView([point.lat, point.lng], LOCATED_ZOOM)

    if (address !== undefined) {
      onAddressChange(address)
      return
    }
    const controller = new AbortController()
    reverseAbortRef.current = controller
    reverseGeocode(point, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) onAddressChange(result ?? null)
      })
      .catch(() => {
        if (!controller.signal.aborted) onAddressChange(null)
      })
  }

  function handleUseMyLocation() {
    setLocating(true)
    setStatus('Finding your location…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        setStatus('Pin placed at your location. Drag it if it is not quite right.')
        commitPoint(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          { recenter: true },
        )
      },
      (error) => {
        setLocating(false)
        setStatus(
          GEOLOCATION_ERRORS[error?.code] ??
            "We couldn't get your location. Tap the map to place the pin instead.",
        )
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    )
  }

  function handleMarkerDragEnd(event) {
    const { lat, lng } = event.target.getLatLng()
    setStatus('')
    commitPoint({ lat, lng })
  }

  function handleMapClick(point) {
    setStatus('')
    commitPoint(point)
  }

  function handlePlaceChosen(place) {
    setStatus(`Pin moved to ${place.label}.`)
    commitPoint({ lat: place.lat, lng: place.lng }, { recenter: true, address: place.label })
  }

  /** Where searches are biased: the pin if set, otherwise the visible map centre. */
  function searchBias() {
    if (value) return value
    const center = mapRef.current?.getCenter?.()
    return center ? { lat: center.lat, lng: center.lng } : config.mapDefaultCenter
  }

  return (
    <div className="space-y-3">
      {addressSearchEnabled && (
        <AddressSearch getBias={searchBias} onChoose={handlePlaceChosen} />
      )}

      {geolocationSupported && (
        <button
          type="button"
          className="btn-secondary w-full sm:w-auto"
          onClick={handleUseMyLocation}
          disabled={locating}
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          )}
          {locating ? 'Locating…' : 'Use my location'}
        </button>
      )}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-gray-600">
        {status}
      </p>

      <div className="relative z-0 h-72 overflow-hidden rounded-lg border border-gray-200">
        <MapContainer
          center={[config.mapDefaultCenter.lat, config.mapDefaultCenter.lng]}
          zoom={config.mapDefaultZoom}
          className="h-full w-full"
          scrollWheelZoom={false}
        >
          <TileLayer url={tileLayer.url} attribution={tileLayer.attribution} />
          <MapBridge mapRef={mapRef} onMapClick={handleMapClick} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={markerIcon}
              draggable
              eventHandlers={{ dragend: handleMarkerDragEnd }}
            />
          )}
        </MapContainer>
      </div>

      {value ? (
        <p className="flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        </p>
      ) : (
        <p className="text-sm text-gray-500">
          Tap the map to drop a pin, drag the pin to adjust it
          {geolocationSupported ? ', or use your location' : ''}.
        </p>
      )}
    </div>
  )
}

/**
 * Address search box following the ARIA combobox pattern.
 * @param {{
 *   getBias: () => { lat: number, lng: number },
 *   onChoose: (place: import('../map.js').Place) => void,
 * }} props
 */
function AddressSearch({ getBias, onChoose }) {
  const id = useId()
  const inputId = `${id}-input`
  const listboxId = `${id}-listbox`
  const getBiasRef = useRef(getBias)
  getBiasRef.current = getBias
  const skipNextSearchRef = useRef(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return undefined
    }
    const text = query.trim()
    if (text.length < 3) {
      setResults([])
      setOpen(false)
      setSearching(false)
      setMessage('')
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      searchAddress(text, getBiasRef.current(), controller.signal)
        .then((places) => {
          if (controller.signal.aborted) return
          setResults(places)
          setActiveIndex(-1)
          setOpen(true)
          setMessage(
            places.length
              ? `${places.length} ${places.length === 1 ? 'address' : 'addresses'} found.`
              : 'No matching addresses. Try another search, or tap the map.',
          )
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setResults([])
          setOpen(false)
          setMessage('Address search is unavailable right now. Tap the map to place the pin.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  function choose(place) {
    skipNextSearchRef.current = true
    setQuery(place.label)
    setResults([])
    setOpen(false)
    setActiveIndex(-1)
    setMessage('')
    onChoose(place)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      if (!results.length) return
      event.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      if (!results.length) return
      event.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (event.key === 'Enter') {
      // Never submit the surrounding report form from the search box.
      event.preventDefault()
      if (open && results.length) choose(results[activeIndex >= 0 ? activeIndex : 0])
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
      }
    }
  }

  const expanded = open && results.length > 0

  return (
    <div className="relative">
      <label htmlFor={inputId} className="label">
        Search for an address
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="text"
          className="input pl-9 pr-9"
          placeholder="Street, landmark or area"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={
            expanded && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        {searching && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400"
            aria-hidden="true"
          />
        )}
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Address suggestions"
        hidden={!expanded}
        className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      >
        {results.map((place, index) => (
          <li
            key={`${place.label}-${place.lat}-${place.lng}`}
            id={`${listboxId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`cursor-pointer px-3 py-2 text-sm ${
              index === activeIndex ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
            }`}
            // Keep focus in the input so blur doesn't close the list before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(place)}
          >
            {place.label}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-gray-500">
        {message}
      </p>
    </div>
  )
}
