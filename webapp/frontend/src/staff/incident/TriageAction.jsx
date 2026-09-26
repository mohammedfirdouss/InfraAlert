import { useState } from 'react'
import { ISSUE_TYPES } from '../ui.jsx'
import { ActionError, Plate, useAction } from './Plate.jsx'

/**
 * Set (or correct) the issue type. Pre-selects the current type, or else what
 * the extraction suggested most often, labelled as the system's suggestion.
 *
 * @param {{
 *   status: string, currentType: string | null, suggestedType: string | null,
 *   primary: boolean, onTriage: (type: string) => Promise<{ ok: boolean, message?: string }>,
 * }} props
 */
export default function TriageAction({ status, currentType, suggestedType, primary, onTriage }) {
  const [choice, setChoice] = useState(currentType ?? suggestedType ?? '')
  const { run, pending, error } = useAction(onTriage)
  const unchanged = status === 'triaged' && choice === currentType

  return (
    <Plate title={currentType ? 'Issue type' : 'Classify'}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (choice && !unchanged) run(choice)
        }}
      >
        <fieldset>
          <legend className="sr-only">Issue type</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {ISSUE_TYPES.map(({ value, label, Icon }) => (
              <label
                key={value}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border-2 px-2 text-sm font-semibold ${
                  choice === value ? 'border-ink bg-signal-100' : 'border-concrete-200 hover:border-concrete-400'
                }`}
              >
                <input
                  type="radio"
                  name="issue-type"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                  className="h-4 w-4 accent-ink"
                />
                <Icon size={16} strokeWidth={2.25} aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {value === suggestedType && (
                  <span className="shrink-0 rounded border border-dashed border-asphalt-400 px-1 text-[10px] font-bold uppercase tracking-sign text-asphalt-500">
                    Suggested<span className="sr-only"> by the system</span>
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        {!suggestedType && (
          <p className="hint">The system couldn&apos;t tell what this is. Read the reports and pick a type.</p>
        )}
        <ActionError message={error} />
        <button
          type="submit"
          className={`${primary ? 'btn-primary' : 'btn-secondary'} mt-3 w-full`}
          disabled={!choice || unchanged || pending}
        >
          {pending ? 'Saving…' : currentType ? 'Save type' : 'Save'}
        </button>
      </form>
    </Plate>
  )
}
