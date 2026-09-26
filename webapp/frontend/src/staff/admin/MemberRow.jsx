/**
 * One staff member: who they are, their role and access, and (for others)
 * controls to change the role or deactivate/reactivate, with inline confirmation.
 */
import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { updateMember } from '../api.js'
import { ROLE_LABELS, formatDateTime } from '../ui.jsx'
import { InlineError, describeError } from './feedback.jsx'

export const MEMBER_ERRORS = {
  last_admin:
    'This is the last active admin. Make someone else an admin first, so someone can still manage staff.',
  cannot_change_own_access: "You can't lower your own role or remove your own access. Ask another admin.",
  already_staff: 'This email already belongs to someone on the staff list.',
  staff_not_found: 'This person is no longer on the staff list. Reload the page.',
}

export const MEMBER_COLS =
  'md:grid md:grid-cols-[minmax(8rem,1.2fr)_minmax(10rem,1.6fr)_6.5rem_7rem_9rem_minmax(15rem,1.4fr)] md:items-center md:gap-3'

const STATUS = {
  invited: { label: 'Invited', className: 'tag border-dashed border-asphalt-400 bg-white' },
  active: { label: 'Active', className: 'tag border-go-600 bg-go-50 text-go-700' },
  deactivated: { label: 'Deactivated', className: 'tag text-asphalt-400' },
}

/**
 * @param {{
 *   member: import('../api.js').Member,
 *   isSelf: boolean,
 *   onUpdated: (member: import('../api.js').Member, message: string) => void,
 * }} props
 */
export default function MemberRow({ member, isSelf, onUpdated }) {
  const id = useId()
  const [pending, setPending] = useState(/** @type {'role' | 'active' | null} */ (null))
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const deactivated = member.status === 'deactivated'
  const status = STATUS[member.status] ?? STATUS.active

  async function save(changes, kind, message) {
    setPending(kind)
    setError('')
    try {
      const updated = await updateMember(member.id, changes)
      setConfirming(false)
      onUpdated(updated, message(updated))
    } catch (err) {
      setError(describeError(err, MEMBER_ERRORS))
    } finally {
      setPending(null)
    }
  }

  const changeRole = (role) =>
    save({ role }, 'role', (m) => `${m.display_name} is now ${ROLE_LABELS[m.role] ?? m.role}.`)
  const setActive = (active) =>
    save({ active }, 'active', (m) =>
      active ? `${m.display_name} is reactivated.` : `${m.display_name} is deactivated.`,
    )

  const selfNoteId = `${id}-self`
  const errorId = `${id}-error`

  return (
    <li
      aria-label={member.display_name}
      className={`grid gap-1.5 px-4 py-2.5 ${MEMBER_COLS} ${deactivated ? 'bg-concrete-50 text-asphalt-500' : ''}`}
    >
      <span className="flex flex-wrap items-center gap-1.5 font-bold text-ink">
        <span className={deactivated ? 'text-asphalt-500' : ''}>{member.display_name}</span>
        {isSelf && <span className="tag border-ink bg-signal-300 text-ink">You</span>}
      </span>
      <span className="break-all text-asphalt-600">{member.email}</span>
      <span>
        <span className="sr-only">Role: </span>
        <span className="tag border-ink bg-white text-ink">{ROLE_LABELS[member.role] ?? member.role}</span>
      </span>
      <span>
        <span className="sr-only">Status: </span>
        <span className={status.className}>{status.label}</span>
      </span>
      <span className="text-xs text-asphalt-500">
        <span className="md:sr-only">Added </span>
        <time dateTime={member.created_at}>{formatDateTime(member.created_at)}</time>
      </span>

      <div className="min-w-0">
        {confirming ? (
          <div role="group" aria-label={`Confirm deactivating ${member.display_name}`} className="animate-rise-in space-y-2">
            <p className="text-[13px] text-ink">
              Deactivate <strong>{member.display_name}</strong>? They lose access to the staff dashboard until you
              reactivate them.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger min-h-[40px] px-3 text-sm"
                disabled={pending !== null}
                onClick={() => setActive(false)}
              >
                {pending === 'active' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Deactivate
              </button>
              <button
                type="button"
                className="btn-secondary min-h-[40px] px-3 text-sm"
                disabled={pending !== null}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-role`} className="sr-only">
              Role for {member.display_name}
            </label>
            <select
              id={`${id}-role`}
              className="input w-auto min-h-[44px] py-1.5 text-sm"
              value={member.role}
              disabled={isSelf || pending !== null}
              aria-describedby={[isSelf ? selfNoteId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
              onChange={(e) => changeRole(e.target.value)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {deactivated ? (
              <button
                type="button"
                className="btn-secondary min-h-[44px] px-3 text-sm"
                disabled={isSelf || pending !== null}
                onClick={() => setActive(true)}
              >
                {pending === 'active' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost px-1 text-sm"
                disabled={isSelf || pending !== null}
                aria-describedby={isSelf ? selfNoteId : undefined}
                onClick={() => {
                  setError('')
                  setConfirming(true)
                }}
              >
                Deactivate
              </button>
            )}
            {pending === 'role' && <Loader2 size={16} className="animate-spin text-asphalt-500" aria-label="Saving" />}
          </div>
        )}
        {isSelf && (
          <p id={selfNoteId} className="mt-1 text-xs text-asphalt-500">
            You can't change your own role or access. Ask another admin.
          </p>
        )}
        <div aria-live="polite">
          <InlineError id={error ? errorId : undefined}>{error}</InlineError>
        </div>
      </div>
    </li>
  )
}
