/**
 * Loads all three queue tabs (so every tab shows a live count), refreshes them
 * every 20 s while the page is visible, and keeps unchanged items as the same
 * objects across refreshes so memoized rows and pins don't re-render.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getQueue } from '../api.js'
import { QUEUE_TABS, filterApplies } from './format.js'

export const REFRESH_INTERVAL_MS = 20_000

/**
 * Structural sharing: reuse the previous object for any item that hasn't
 * changed, and the previous array if nothing changed at all.
 * @template {{ id: string }} T
 * @param {T[] | undefined} prev @param {T[]} next @returns {T[]}
 */
export function reconcile(prev, next) {
  if (!prev?.length) return next
  const byId = new Map(prev.map((item) => [item.id, item]))
  let unchanged = prev.length === next.length
  const merged = next.map((item, i) => {
    const old = byId.get(item.id)
    const kept = old && JSON.stringify(old) === JSON.stringify(item) ? old : item
    if (kept !== prev[i]) unchanged = false
    return kept
  })
  return unchanged ? prev : merged
}

const EMPTY = { triage: undefined, open: undefined, closed: undefined }

/**
 * @param {import('./format.js').QueueTab} tab  the visible tab: switching refreshes
 * @param {string | null} issueType  applies to 'open' and 'closed'
 */
export function useQueueData(tab, issueType) {
  /** @type {[Record<string, import('../api.js').QueueItem[] | undefined>, Function]} */
  const [data, setData] = useState(EMPTY)
  /** @type {[Record<string, Error | null>, Function]} */
  const [errors, setErrors] = useState({})
  const [lastUpdated, setLastUpdated] = useState(/** @type {Date | null} */ (null))
  const [refreshing, setRefreshing] = useState(false)

  const issueTypeRef = useRef(issueType)
  const requestRef = useRef(0)
  const lastFetchRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    const type = issueTypeRef.current
    lastFetchRef.current = Date.now()
    setRefreshing(true)
    const results = await Promise.allSettled(
      QUEUE_TABS.map((t) => getQueue(t, filterApplies(t) ? type : null)),
    )
    // A newer request (or unmount) supersedes this one.
    if (request !== requestRef.current) return
    setData((prev) => {
      const next = { ...prev }
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[QUEUE_TABS[i]] = reconcile(prev[QUEUE_TABS[i]], r.value)
      })
      return next
    })
    setErrors(
      Object.fromEntries(
        results.map((r, i) => [QUEUE_TABS[i], r.status === 'rejected' ? r.reason : null]),
      ),
    )
    if (results.some((r) => r.status === 'fulfilled')) setLastUpdated(new Date())
    setRefreshing(false)
  }, [])

  // Load on mount, tab switch and filter change. A new filter invalidates the
  // filtered tabs, which show the loading state until the new results arrive.
  useEffect(() => {
    if (issueTypeRef.current !== issueType) {
      issueTypeRef.current = issueType
      setData((prev) => ({ ...EMPTY, triage: prev.triage }))
      setErrors((prev) => ({ triage: prev.triage ?? null }))
    }
    refresh()
  }, [tab, issueType, refresh])

  // Auto-refresh while visible; catch up at once when the page comes back.
  useEffect(() => {
    let timer = null
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const start = () => {
      stop()
      timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        return
      }
      if (Date.now() - lastFetchRef.current >= REFRESH_INTERVAL_MS) refresh()
      start()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  // Ignore responses that land after unmount.
  useEffect(() => () => void (requestRef.current += 1), [])

  return { data, errors, lastUpdated, refreshing, refresh }
}
