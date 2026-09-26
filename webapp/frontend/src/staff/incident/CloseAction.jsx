import { useState } from 'react'
import { ActionError, useAction } from './Plate.jsx'

const MIN_REASON = 3

/**
 * Close as invalid, behind an inline confirmation with a required reason.
 * @param {{ reference: string, teamName: string | null, onClose: (reason: string) => Promise<{ ok: boolean, message?: string }> }} props
 */
export default function CloseAction({ reference, teamName, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const { run, pending, error } = useAction(onClose)
  const tooShort = reason.trim().length < MIN_REASON

  if (!confirming) {
    return (
      <button type="button" className="btn-secondary w-full" onClick={() => setConfirming(true)}>
        Close as invalid…
      </button>
    )
  }

  return (
    <form
      className="space-y-2 rounded-lg border-2 border-hazard-500 bg-hazard-50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (!tooShort) run(reason.trim())
      }}
      noValidate
    >
      <p className="text-sm font-bold" id="close-confirm">
        Close {reference} as invalid? Citizens will see &lsquo;Closed&rsquo;.
        {teamName && ` ${teamName} will be released.`}
      </p>
      <label htmlFor="close-reason" className="label">
        Reason (required)
      </label>
      <textarea
        id="close-reason"
        className="input min-h-[64px]"
        maxLength={1000}
        value={reason}
        aria-invalid={tried && tooShort ? 'true' : undefined}
        aria-describedby={tried && tooShort ? 'close-reason-error' : undefined}
        onChange={(e) => setReason(e.target.value)}
      />
      {tried && tooShort && (
        <p id="close-reason-error" className="field-error">
          Say why in a few words (at least {MIN_REASON} characters).
        </p>
      )}
      <ActionError message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-danger flex-1" disabled={pending} aria-describedby="close-confirm">
          {pending ? 'Closing…' : 'Close as invalid'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
