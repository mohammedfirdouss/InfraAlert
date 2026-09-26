import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

/**
 * A full-screen photo viewer. Escape closes; the arrow keys step through the
 * photos. Focus moves into the dialog, stays there, and returns on close.
 *
 * @param {{
 *   photos: { id: string, url: string }[], index: number,
 *   onIndexChange: (i: number) => void, onClose: () => void, onImageError?: () => void,
 *   label?: string,
 * }} props
 */
export default function Lightbox({ photos, index, onIndexChange, onClose, onImageError, label = 'Photo' }) {
  const closeRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const count = photos.length
  const photo = photos[index]

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight' && count > 1) {
        e.preventDefault()
        onIndexChange((index + 1) % count)
      } else if (e.key === 'ArrowLeft' && count > 1) {
        e.preventDefault()
        onIndexChange((index - 1 + count) % count)
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusable = dialogRef.current?.querySelectorAll('button')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, count, onClose, onIndexChange])

  if (!photo) return null
  const position = `${label} ${index + 1} of ${count}`

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={position}
      className="fixed inset-0 z-[2000] flex flex-col bg-ink/95 p-4 text-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-signal-300" aria-live="polite">
          {index + 1} / {count}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="btn border-white bg-transparent text-white hover:bg-asphalt-700"
          aria-label="Close photo"
        >
          <X size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center py-3">
        <img
          src={photo.url}
          alt={position}
          onError={onImageError}
          className="max-h-full max-w-full rounded border-2 border-white object-contain"
        />
      </div>
      {count > 1 && (
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => onIndexChange((index - 1 + count) % count)}
            className="btn border-white bg-transparent text-white hover:bg-asphalt-700"
            aria-label="Previous photo"
          >
            <ChevronLeft size={20} strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onIndexChange((index + 1) % count)}
            className="btn border-white bg-transparent text-white hover:bg-asphalt-700"
            aria-label="Next photo"
          >
            <ChevronRight size={20} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
