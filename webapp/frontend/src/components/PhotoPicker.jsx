/**
 * PhotoPicker: choose and upload up to MAX_PHOTOS_PER_REPORT photos (ADR 0008).
 *
 * Each photo goes straight to the private bucket through a signed URL as soon as
 * it is picked, so the report submit itself stays small on slow mobile data.
 * Only finished uploads are reported through `onChange`, in tile order.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, Check, ImageIcon, RotateCw, X } from 'lucide-react'
import {
  ApiError,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_REPORT,
  PHOTO_CONTENT_TYPES,
  requestUpload,
  uploadPhoto,
} from '../api/client.js'

const ACCEPT = [...PHOTO_CONTENT_TYPES, '.heic', '.heif'].join(',')
const MAX_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024))

/**
 * The content type to upload a file as, or null when it isn't allowed.
 * Some platforms give HEIC/HEIF files an empty or `image/heif` type.
 * @param {File} file
 * @returns {string | null}
 */
function photoContentType(file) {
  const type = (file.type || '').toLowerCase()
  if (PHOTO_CONTENT_TYPES.includes(type)) return type
  if (type === 'image/heif') return 'image/heic'
  if (!type && /\.(heic|heif)$/i.test(file.name || '')) return 'image/heic'
  return null
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function uploadErrorMessage(err) {
  if (err instanceof ApiError && err.status === 429) {
    return 'Too many uploads right now. Wait a moment and retry.'
  }
  return 'Upload failed. Check your connection and retry.'
}

function isAbort(err, signal) {
  return signal.aborted || (err && err.name === 'AbortError')
}

/**
 * @typedef {{
 *   id: number,
 *   file: File,
 *   contentType: string,
 *   previewUrl: string | null,
 *   status: 'uploading' | 'done' | 'error',
 *   progress: number,
 *   objectName: string | null,
 *   error: string | null,
 * }} Tile
 */

/**
 * @param {{
 *   value: string[],                        // object names of finished uploads
 *   onChange: (objectNames: string[]) => void,
 *   onBusyChange?: (busy: boolean) => void, // true while any upload is in flight
 *   disabled?: boolean,
 * }} props
 */
export default function PhotoPicker({ value, onChange, onBusyChange, disabled = false }) {
  /** @type {[Tile[], Function]} */
  const [tiles, setTiles] = useState([])
  const [message, setMessage] = useState('')
  const nextId = useRef(1)
  const controllers = useRef(new Map())
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  const onChangeRef = useRef(onChange)
  const onBusyChangeRef = useRef(onBusyChange)
  onChangeRef.current = onChange
  onBusyChangeRef.current = onBusyChange

  const updateTile = useCallback((id, patch) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const startUpload = useCallback(
    async (id, file, contentType) => {
      controllers.current.get(id)?.abort()
      const controller = new AbortController()
      controllers.current.set(id, controller)
      const { signal } = controller
      updateTile(id, { status: 'uploading', progress: 0, error: null })
      try {
        const target = await requestUpload(contentType)
        if (signal.aborted) return
        await uploadPhoto(
          target,
          file,
          (fraction) => {
            if (!signal.aborted) updateTile(id, { progress: fraction })
          },
          signal,
        )
        if (signal.aborted) return
        updateTile(id, { status: 'done', progress: 1, objectName: target.object_name })
      } catch (err) {
        if (isAbort(err, signal)) return
        updateTile(id, { status: 'error', error: uploadErrorMessage(err) })
      } finally {
        if (controllers.current.get(id) === controller) controllers.current.delete(id)
      }
    },
    [updateTile],
  )

  // Report finished uploads (tile order) whenever that list changes.
  const doneNames = tiles.filter((t) => t.status === 'done').map((t) => t.objectName)
  const doneKey = doneNames.join('\n')
  const lastEmitted = useRef((value || []).join('\n'))
  useEffect(() => {
    if (doneKey === lastEmitted.current) return
    lastEmitted.current = doneKey
    onChangeRef.current(doneKey ? doneKey.split('\n') : [])
  }, [doneKey])

  // Follow the parent when it clears `value` (e.g. after 409 'photo_already_used'):
  // drop every tile, abort uploads and free previews. An echo of our own
  // onChange([]) (user removed the last finished photo) is not a clear.
  const valueKey = (value || []).join('\n')
  useEffect(() => {
    if (valueKey !== '' || lastEmitted.current === '') return
    lastEmitted.current = ''
    for (const c of controllers.current.values()) c.abort()
    controllers.current.clear()
    for (const t of tilesRef.current) {
      if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
    }
    setTiles([])
    setMessage('')
  }, [valueKey])

  // Report "any upload in flight" transitions.
  const busy = tiles.some((t) => t.status === 'uploading')
  const lastBusy = useRef(false)
  useEffect(() => {
    if (busy === lastBusy.current) return
    lastBusy.current = busy
    onBusyChangeRef.current?.(busy)
  }, [busy])

  // On unmount: abort uploads, free previews, and clear the busy flag.
  useEffect(
    () => () => {
      for (const c of controllers.current.values()) c.abort()
      controllers.current.clear()
      for (const t of tilesRef.current) {
        if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
      }
      if (lastBusy.current) {
        lastBusy.current = false
        onBusyChangeRef.current?.(false)
      }
    },
    [],
  )

  function handleFiles(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = '' // let the same file be picked again
    if (files.length === 0) return

    const problems = []
    const accepted = []
    let room = MAX_PHOTOS_PER_REPORT - tilesRef.current.length
    let overLimit = 0
    for (const file of files) {
      const contentType = photoContentType(file)
      if (!contentType) {
        problems.push(`"${file.name}" isn't a supported photo. Use JPEG, PNG, WebP or HEIC.`)
      } else if (file.size > MAX_PHOTO_BYTES) {
        problems.push(
          `"${file.name}" is too large (${formatMb(file.size)}). Photos must be ${MAX_MB} MB or smaller.`,
        )
      } else if (room <= 0) {
        overLimit += 1
      } else {
        room -= 1
        const canPreview = contentType !== 'image/heic' && typeof URL.createObjectURL === 'function'
        accepted.push({
          id: nextId.current++,
          file,
          contentType,
          previewUrl: canPreview ? URL.createObjectURL(file) : null,
          status: 'uploading',
          progress: 0,
          objectName: null,
          error: null,
        })
      }
    }
    if (overLimit > 0) {
      problems.push(
        `You can add up to ${MAX_PHOTOS_PER_REPORT} photos. ${overLimit} ${
          overLimit === 1 ? 'photo was' : 'photos were'
        } not added.`,
      )
    }
    setMessage(problems.join(' '))
    if (accepted.length === 0) return
    setTiles((prev) => [...prev, ...accepted])
    for (const tile of accepted) startUpload(tile.id, tile.file, tile.contentType)
  }

  function removeTile(tile) {
    controllers.current.get(tile.id)?.abort()
    controllers.current.delete(tile.id)
    if (tile.previewUrl) URL.revokeObjectURL(tile.previewUrl)
    setTiles((prev) => prev.filter((t) => t.id !== tile.id))
    setMessage('Photo removed.')
  }

  const atLimit = tiles.length >= MAX_PHOTOS_PER_REPORT

  return (
    <div data-testid="photo-picker">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {tiles.length > 0 && (
          // `contents` lets the tiles and the add tile share one grid; role="list"
          // keeps list semantics that some browsers drop with display: contents.
          <ul role="list" className="contents" aria-label="Photos">
            {tiles.map((tile, index) => (
              <PhotoTile
                key={tile.id}
                tile={tile}
                index={index}
                disabled={disabled}
                onRemove={() => removeTile(tile)}
                onRetry={() => startUpload(tile.id, tile.file, tile.contentType)}
              />
            ))}
          </ul>
        )}

        {!atLimit && (
          <label
            className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-concrete-400 bg-concrete-50 p-2 text-center text-asphalt-600 transition-colors focus-within:border-solid focus-within:border-ink focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-ink ${
              disabled
                ? 'cursor-not-allowed opacity-45'
                : 'cursor-pointer hover:border-ink hover:bg-white hover:text-ink'
            }`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-current">
              <Camera size={18} strokeWidth={2.25} aria-hidden="true" />
            </span>
            <span className="text-[13px] font-bold leading-tight">Add photos</span>
            <input
              type="file"
              className="sr-only"
              accept={ACCEPT}
              multiple
              disabled={disabled}
              onChange={handleFiles}
            />
          </label>
        )}
      </div>

      <p className="hint">
        {atLimit
          ? `You've added the maximum of ${MAX_PHOTOS_PER_REPORT} photos.`
          : `Up to ${MAX_PHOTOS_PER_REPORT} photos, ${MAX_MB} MB each (JPEG, PNG, WebP or HEIC).`}
      </p>

      <p
        role="status"
        aria-live="polite"
        className="mt-2 text-[13px] font-semibold text-asphalt-700 empty:hidden"
      >
        {message}
      </p>
    </div>
  )
}

/**
 * One photo: preview, upload progress, error with Retry, and Remove.
 * @param {{ tile: Tile, index: number, disabled: boolean, onRemove: () => void, onRetry: () => void }} props
 */
function PhotoTile({ tile, index, disabled, onRemove, onRetry }) {
  const label = `Photo ${index + 1}`
  const percent = Math.round(tile.progress * 100)
  const failed = tile.status === 'error'
  return (
    <li
      className={`relative aspect-square animate-rise-in overflow-hidden rounded-lg border-2 bg-concrete-100 ${
        failed ? 'border-hazard-500' : 'border-ink'
      }`}
    >
      <div className="flex h-full w-full items-center justify-center">
        {tile.previewUrl ? (
          <img src={tile.previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon
            size={32}
            strokeWidth={1.75}
            className="text-asphalt-400"
            role="img"
            aria-label={label}
          />
        )}
      </div>

      <span
        className="readout absolute left-1.5 top-1.5 px-1.5 py-0.5 text-[11px] leading-none"
        aria-hidden="true"
      >
        {String(index + 1).padStart(2, '0')}
      </span>

      {tile.status === 'uploading' && (
        <div
          role="progressbar"
          aria-label={`Uploading ${label.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="absolute inset-x-0 bottom-0 h-2 border-t-2 border-ink bg-ink/40"
        >
          <div
            className="h-full bg-signal-400 transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {tile.status === 'done' && (
        <span className="absolute bottom-1.5 left-1.5 flex h-6 w-6 animate-rise-in items-center justify-center rounded-full border-2 border-ink bg-go-500 text-white">
          <Check size={14} strokeWidth={3} role="img" aria-label={`${label} uploaded`} />
        </span>
      )}

      {failed && (
        <div className="absolute inset-0 flex animate-rise-in flex-col items-center justify-center gap-1.5 bg-hazard-50/95 px-1.5 pb-1.5 pt-9 text-center sm:pt-1.5">
          <AlertCircle size={18} strokeWidth={2.25} className="hidden text-hazard-600 sm:block" aria-hidden="true" />
          <p role="alert" className="text-[11px] font-semibold leading-tight text-hazard-700">
            {tile.error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className="btn-secondary min-h-[36px] px-2.5 py-1 text-xs"
            aria-label={`Retry ${label.toLowerCase()}`}
          >
            <RotateCw size={14} strokeWidth={2.5} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${label.toLowerCase()}`}
        className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-ink text-white transition-transform hover:scale-105 disabled:opacity-45"
      >
        <X size={16} strokeWidth={2.75} aria-hidden="true" />
      </button>
    </li>
  )
}
