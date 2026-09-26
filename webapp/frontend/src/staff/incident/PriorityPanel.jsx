import { formatDistance, formatScore } from '../ui.jsx'

const COMPONENTS = [
  { key: 'hazard', label: 'Hazard', swatch: 'bg-hazard-500' },
  { key: 'type', label: 'Issue type', swatch: 'bg-ink' },
  { key: 'place', label: 'Sensitive places', swatch: 'bg-signal-400' },
  { key: 'volume', label: 'Report volume', swatch: 'bg-concrete-400' },
]

const PLACE_LABELS = {
  hospital: 'Hospital',
  school: 'School',
  fire_station: 'Fire station',
  clinic: 'Clinic',
  police: 'Police station',
  major_road: 'Major road',
  market: 'Market',
}

const fmt = (n) => n.toFixed(2)

/**
 * "Why is this ranked here?" (ADR 0004): the stored breakdown of the versioned
 * formula, as a stacked bar of each component's contribution to the score.
 *
 * @param {{ incident: import('../api.js').IncidentDetail }} props
 */
export default function PriorityPanel({ incident }) {
  const inputs = incident.priority_inputs
  const score = incident.item.priority_score

  return (
    <section aria-labelledby="priority-title" className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="priority-title" className="section-title">
          Why this priority
        </h2>
        {incident.formula_version && (
          <span className="font-mono text-[11px] text-asphalt-500">Formula {incident.formula_version}</span>
        )}
      </div>

      {!inputs?.components ? (
        <p className="mt-2 text-sm text-asphalt-600">Scored after classification. Set the issue type to rank it.</p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold">{score != null ? formatScore(score) : '—'}</span>
            <span className="text-xs text-asphalt-500">out of 1.00</span>
          </div>

          <div
            className="relative mt-2 flex h-4 w-full overflow-hidden rounded border-2 border-ink bg-concrete-100"
            role="img"
            aria-label={`Score breakdown: ${COMPONENTS.map(
              (c) => `${c.label} ${fmt(inputs.components[c.key]?.contribution ?? 0)}`,
            ).join(', ')}`}
          >
            {COMPONENTS.map((c) => {
              const contribution = inputs.components[c.key]?.contribution ?? 0
              if (contribution <= 0) return null
              return (
                <span
                  key={c.key}
                  data-testid={`bar-${c.key}`}
                  className={`${c.swatch} h-full border-r border-white last:border-r-0`}
                  style={{ width: `${Math.min(100, contribution * 100)}%` }}
                />
              )
            })}
            {inputs.floor_applied && score != null && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 w-0.5 bg-ink"
                style={{ left: `${Math.min(100, score * 100)}%` }}
              />
            )}
          </div>

          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Priority components</caption>
            <thead className="text-left text-[11px] uppercase tracking-sign text-asphalt-500">
              <tr>
                <th className="py-1 font-bold">Component</th>
                <th className="py-1 text-right font-bold">Value × weight</th>
                <th className="py-1 text-right font-bold">Adds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-concrete-200">
              {COMPONENTS.map((c) => {
                const part = inputs.components[c.key]
                if (!part) return null
                return (
                  <tr key={c.key}>
                    <th scope="row" className="py-1.5 text-left font-semibold">
                      <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-sm border border-ink ${c.swatch}`} aria-hidden="true" />
                      {c.label}
                    </th>
                    <td className="py-1.5 text-right font-mono text-xs text-asphalt-600">
                      {fmt(part.value)} × {fmt(part.weight)}
                    </td>
                    <td className="py-1.5 text-right font-mono">{fmt(part.contribution)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {inputs.floor_applied && (
            <p className="mt-2 rounded border-2 border-hazard-500 bg-hazard-50 px-2 py-1.5 text-[13px] font-semibold text-hazard-700">
              Life-safety floor applied: a life-safety hazard lifts the score to at least 0.75 (CRITICAL), whatever the
              sum.
            </p>
          )}

          <div className="mt-3">
            <h3 className="text-[13px] font-bold">Nearby sensitive places</h3>
            {inputs.nearby_places?.length ? (
              <ul className="mt-1 space-y-0.5 text-sm">
                {inputs.nearby_places.map((p, i) => (
                  <li key={`${p.category}-${i}`} className="flex justify-between gap-2">
                    <span>{PLACE_LABELS[p.category] ?? p.category.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-xs text-asphalt-500">{formatDistance(p.distance_m)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-asphalt-500">None within 300 m.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
