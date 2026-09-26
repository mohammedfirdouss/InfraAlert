/**
 * Staff (admin only, ADR 0007): who can sign in to the dashboard and with what
 * role. Staff are invited by email and become active on their first sign-in.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMembers } from '../api.js'
import { useStaff } from '../auth.jsx'
import InviteForm from '../admin/InviteForm.jsx'
import MemberRow, { MEMBER_COLS } from '../admin/MemberRow.jsx'
import { EmptyState, LoadError, SkeletonRows, Toasts, describeError, useToasts } from '../admin/feedback.jsx'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'invited', label: 'Invited' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
]

const byEmail = (a, b) => a.email.toLowerCase().localeCompare(b.email.toLowerCase())

export default function Members() {
  const me = useStaff()?.staff ?? null
  const [members, setMembers] = useState(/** @type {import('../api.js').Member[] | null} */ (null))
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('all')
  const { toasts, notify, dismiss } = useToasts()

  const load = useCallback(() => {
    setLoadError('')
    setMembers(null)
    getMembers()
      .then(setMembers)
      .catch((error) => setLoadError(describeError(error)))
  }, [])

  useEffect(load, [load])

  const counts = useMemo(() => {
    const c = { all: 0, invited: 0, active: 0, deactivated: 0 }
    for (const m of members ?? []) {
      c.all += 1
      c[m.status] = (c[m.status] ?? 0) + 1
    }
    return c
  }, [members])

  const shown = (members ?? []).filter((m) => filter === 'all' || m.status === filter)

  function upsert(member) {
    setMembers((list) => [...(list ?? []).filter((m) => m.id !== member.id), member].sort(byEmail))
  }

  function handleInvited(member) {
    upsert(member)
    // Make sure the new row is visible.
    if (filter !== 'all' && filter !== member.status) setFilter('all')
    notify(`${member.display_name} invited.`)
  }

  return (
    <div className="space-y-4 p-4 text-sm lg:p-6">
      <header>
        <h1 className="text-2xl font-black">Staff</h1>
        <p className="text-asphalt-500">Who can sign in to the dashboard, and what they can do.</p>
      </header>

      <InviteForm onInvited={handleInvited} />

      <section aria-labelledby="staff-list-title" className="overflow-hidden rounded-lg border border-concrete-300 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-concrete-300 px-4 py-2">
          <h2 id="staff-list-title" className="section-title">
            Staff list
          </h2>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md border-2 px-3 text-[13px] font-bold ${
                  filter === value
                    ? 'border-ink bg-ink text-white'
                    : 'border-transparent text-asphalt-600 hover:border-concrete-300'
                }`}
              >
                {label}
                {members && (
                  <span className={`font-mono text-xs ${filter === value ? 'text-signal-300' : 'text-asphalt-400'}`}>
                    {counts[value]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div
          aria-hidden="true"
          className={`hidden border-b border-concrete-300 bg-concrete-100 px-4 py-2 text-[11px] font-extrabold uppercase tracking-sign text-asphalt-600 ${MEMBER_COLS}`}
        >
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Added</span>
          <span>Change</span>
        </div>

        {loadError ? (
          <LoadError message={`We couldn't load the staff list. ${loadError}`} onRetry={load} />
        ) : members === null ? (
          <SkeletonRows label="Loading staff" />
        ) : shown.length === 0 ? (
          <EmptyState title={filter === 'all' ? 'No staff yet' : `No ${filter} staff`}>
            {filter === 'all' ? 'Invite someone with the form above.' : 'Try another filter.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-concrete-200">
            {shown.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={member.id === me?.id}
                onUpdated={(updated, message) => {
                  upsert(updated)
                  notify(message)
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  )
}
