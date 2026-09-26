import { useCallback, useEffect, useRef, useState } from 'react'
import { getIncident } from '../api.js'

/** Photo links are signed for about 15 minutes; refresh well before that on return. */
export const STALE_AFTER_MS = 10 * 60 * 1000

/**
 * Load one incident, keep it fresh, and expose a reload for after actions.
 * Reloads keep the current data on screen (no skeleton flash).
 *
 * @param {string} id
 */
export function useIncident(id) {
  const [data, setData] = useState(/** @type {Awaited<ReturnType<typeof getIncident>> | null} */ (null))
  const [error, setError] = useState(/** @type {unknown} */ (null))
  const [loading, setLoading] = useState(true)
  const loadedAt = useRef(0)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await getIncident(id)
      if (ticket !== latest.current) return
      loadedAt.current = Date.now()
      setData(next)
      setError(null)
    } catch (err) {
      if (ticket !== latest.current) return
      setError(err)
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [id])

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    return reload()
  }, [reload])

  useEffect(() => {
    reload()
  }, [reload])

  // Coming back to the tab after a while: the photo links may have expired.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'hidden') return
      if (loadedAt.current && Date.now() - loadedAt.current > STALE_AFTER_MS) reload()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [reload])

  // A photo failed to load: its link has probably expired. Refresh, at most every 30s.
  const lastPhotoRefresh = useRef(0)
  const onPhotoError = useCallback(() => {
    if (Date.now() - lastPhotoRefresh.current < 30_000) return
    lastPhotoRefresh.current = Date.now()
    reload()
  }, [reload])

  return { data, error, loading, reload, retry, onPhotoError }
}
