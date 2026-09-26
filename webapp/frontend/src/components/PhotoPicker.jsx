/**
 * PhotoPicker: choose and upload up to MAX_PHOTOS_PER_REPORT photos (ADR 0008).
 *
 * Each photo goes straight to the private bucket through a signed URL as soon as
 * it is picked, so the report submit itself stays small on slow mobile data.
 * Only finished uploads are reported through `onChange`, in tile order.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, ImageIcon, RotateCw, X } from 'lucide-react'
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
    <div className="space-y-3" data-testid="photo-picker">
      {tiles.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="Photos">
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

      {atLimit ? (
        <p className="text-xs text-gray-500">
          You've added the maximum of {MAX_PHOTOS_PER_REPORT} photos.
        </p>
      ) : (
        <div>
          <label
            className={`btn-secondary w-full sm:w-auto ${
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            } focus-within:ring-2 focus-within:ring-primary-500`}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>Add photos</span>
            <input
              type="file"
              className="sr-only"
              accept={ACCEPT}
              multiple
              disabled={disabled}
              onChange={handleFiles}
            />
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Optional. Up to {MAX_PHOTOS_PER_REPORT} photos, {MAX_MB} MB each (JPEG, PNG, WebP or
            HEIC).
          </p>
        </div>
      )}

      <p role="status" aria-live="polite" className="text-sm text-gray-700 empty:hidden">
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
  return (
    <li className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex aspect-square items-center justify-center">
        {tile.previewUrl ? (
          <img src={tile.previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-8 w-8 text-gray-400" role="img" aria-label={label} />
        )}
      </div>

      {tile.status === 'uploading' && (
        <div className="absolute inset-x-0 bottom-0 bg-white/90 p-1.5">
          <div
            role="progressbar"
            aria-label={`Uploading ${label.toLowerCase()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className="h-full bg-primary-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {tile.status === 'done' && (
        <CheckCircle2
          className="absolute bottom-1 left-1 h-5 w-5 rounded-full bg-white text-success-600"
          aria-label={`${label} uploaded`}
          role="img"
        />
      )}

      {tile.status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/90 p-1 text-center">
          <AlertCircle className="h-5 w-5 text-danger-600" aria-hidden="true" />
          <p role="alert" className="text-[11px] leading-tight text-danger-600">
            {tile.error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className="btn-secondary px-2 py-1 text-xs"
            aria-label={`Retry ${label.toLowerCase()}`}
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${label.toLowerCase()}`}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 focus-visible:ring-2 disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  )
}
