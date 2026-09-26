import { useState } from 'react'
import { ActionError, Plate, useAction } from './Plate.jsx'

/**
 * Record the team's progress: on site, then resolved (with an optional note).
 * @param {{
 *   canOnSite: boolean, canResolve: boolean, teamName: string | null,
 *   primary: 'on_site' | 'resolve' | null,
 *   onOnSite: () => Promise<{ ok: boolean, message?: string }>,
 *   onResolve: (note: string) => Promise<{ ok: boolean, message?: string }>,
 * }} props
 */
export default function ProgressActions({ canOnSite, canResolve, teamName, primary, onOnSite, onResolve }) {
  const onSite = useAction(onOnSite)
  const resolve = useAction(onResolve)
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')
  if (!canOnSite && !canResolve) return null

  return (
    <Plate title="Progress">
      <div className="space-y-2">
        {canOnSite && (
          <>
            <button
              type="button"
              className={`${primary === 'on_site' ? 'btn-primary' : 'btn-secondary'} w-full`}
              disabled={onSite.pending}
              onClick={() => onSite.run()}
            >
              {onSite.pending ? 'Saving…' : `Mark ${teamName ?? 'the team'} on site`}
            </button>
            <ActionError message={onSite.error} />
          </>
        )}
        {canResolve &&
          (resolving ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                resolve.run(note.trim())
              }}
            >
              <label htmlFor="resolve-note" className="label">
                Resolution note <span className="font-normal text-asphalt-500">(optional, staff only)</span>
              </label>
              <textarea
                id="resolve-note"
                className="input min-h-[72px]"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="hint">Every citizen who reported this will see it as resolved.</p>
              <ActionError message={resolve.error} />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className={`${primary === 'resolve' ? 'btn-primary' : 'btn-secondary'} flex-1`}
                  disabled={resolve.pending}
                >
                  {resolve.pending ? 'Saving…' : 'Mark resolved'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setResolving(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className={`${primary === 'resolve' ? 'btn-primary' : 'btn-secondary'} w-full`}
              onClick={() => setResolving(true)}
            >
              Resolve…
            </button>
          ))}
      </div>
    </Plate>
  )
}
