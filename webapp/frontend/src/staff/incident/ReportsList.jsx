import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { HazardFlags, IssueTypeLabel, formatDateTime } from '../ui.jsx'
import Lightbox from './Lightbox.jsx'
import { LOW_CONFIDENCE } from './format.js'

/**
 * The extraction's reading of one report, visibly a hint to verify (ADR 0004).
 * @param {{ report: import('../api.js').IncidentReport }} props
 */
function SystemReading({ report }) {
  const hasReading = report.issue_type || report.summary || report.confidence != null
  const low = report.confidence != null && report.confidence < LOW_CONFIDENCE
  return (
    <div className="mt-3 rounded-md border-2 border-dashed border-asphalt-400 bg-concrete-50 p-2.5 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-sign text-asphalt-500">
        <Sparkles size={12} strokeWidth={2.5} aria-hidden="true" />
        Suggested by the system
      </p>
      {!hasReading ? (
        <p className="text-asphalt-600">
          {report.processing === 'received'
            ? 'Not read yet. The system is still processing this report.'
            : "The system couldn't read this report. Classify it from the description and photos."}
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <IssueTypeLabel value={report.issue_type} className="font-semibold" />
            {report.confidence != null && (
              <span
                className={`font-mono text-xs ${low ? 'font-semibold text-hazard-700' : 'text-asphalt-600'}`}
              >
                {Math.round(report.confidence * 100)}% confident{low ? ' (low)' : ''}
              </span>
            )}
          </div>
          <HazardFlags flags={report.hazard_flags} />
          {report.summary && <p className="text-asphalt-700">{report.summary}</p>}
        </div>
      )}
    </div>
  )
}

const coords = (loc) => `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`

/**
 * Every citizen report in the incident, oldest first, with photos and the
 * system's reading. When splitting is possible, each has a checkbox.
 *
 * @param {{
 *   reports: import('../api.js').IncidentReport[],
 *   selectable: boolean, selected: string[], onToggle: (id: string) => void,
 *   onPhotoError: () => void,
 * }} props
 */
export default function ReportsList({ reports, selectable, selected, onToggle, onPhotoError }) {
  const [viewing, setViewing] = useState(/** @type {{ report: number, photo: number } | null} */ (null))
  const viewingReport = viewing ? reports[viewing.report] : null

  return (
    <section aria-labelledby="reports-title" className="card p-4">
      <h2 id="reports-title" className="section-title">
        Reports <span className="font-mono font-semibold text-asphalt-400">{reports.length}</span>
      </h2>
      {selectable && (
        <p className="hint mt-1">Tick reports that don&apos;t belong here to move them to a new incident.</p>
      )}
      <ol className="mt-2 divide-y divide-concrete-200">
        {reports.map((report, ri) => {
          const checkboxId = `split-${report.id}`
          return (
            <li key={report.id} className="flex gap-3 py-3">
              {selectable && (
                <div className="pt-0.5">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={selected.includes(report.id)}
                    onChange={() => onToggle(report.id)}
                    className="h-5 w-5 accent-ink"
                    aria-label={`Select report ${ri + 1} to move`}
                  />
                </div>
              )}
              <article className="min-w-0 flex-1" aria-label={`Report ${ri + 1}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-asphalt-500">
                  <span className="font-mono font-semibold text-ink">#{ri + 1}</span>
                  <time dateTime={report.submitted_at}>{formatDateTime(report.submitted_at)}</time>
                  <span>{report.address_text ?? <span className="font-mono">{coords(report.location)}</span>}</span>
                </div>
                <blockquote className="mt-2 border-l-4 border-ink pl-3 text-[15px] leading-snug">
                  {report.description}
                </blockquote>
                {report.photos.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="Photos">
                    {report.photos.map((photo, pi) => (
                      <li key={photo.id}>
                        <button
                          type="button"
                          onClick={() => setViewing({ report: ri, photo: pi })}
                          className="block h-20 w-20 overflow-hidden rounded border-2 border-ink bg-concrete-200"
                          aria-label={`Open photo ${pi + 1} of ${report.photos.length} from report ${ri + 1}`}
                        >
                          <img
                            src={photo.url}
                            alt=""
                            loading="lazy"
                            onError={onPhotoError}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <SystemReading report={report} />
              </article>
            </li>
          )
        })}
      </ol>
      {viewing && viewingReport && (
        <Lightbox
          photos={viewingReport.photos}
          index={viewing.photo}
          label={`Report ${viewing.report + 1} photo`}
          onIndexChange={(photo) => setViewing({ ...viewing, photo })}
          onClose={() => setViewing(null)}
          onImageError={onPhotoError}
        />
      )}
    </section>
  )
}
