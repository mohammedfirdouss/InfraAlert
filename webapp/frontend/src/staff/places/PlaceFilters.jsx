/**
 * Filters for the places list: name search, category (with its weight),
 * source and status.
 */
import { Search } from 'lucide-react'
import { categoryOptionLabel } from './format.js'

const SOURCES = [
  { value: '', label: 'All' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'manual', label: 'Added by staff' },
]
const STATUSES = [
  { value: '', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]

function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border-2 border-ink">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-[40px] border-l-2 border-ink px-3 text-[13px] font-bold first:border-l-0 ${
            value === option.value ? 'bg-ink text-signal-300' : 'bg-white text-ink hover:bg-concrete-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * @param {{
 *   filters: import('./format.js').PlaceFilters,
 *   categories: import('../api.js').PlaceCategory[],
 *   onChange: (filters: import('./format.js').PlaceFilters) => void,
 * }} props
 */
export default function PlaceFilters({ filters, categories, onChange }) {
  const set = (field) => (value) => onChange({ ...filters, [field]: value })
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-64">
        <label htmlFor="places-search" className="label">
          Search
        </label>
        <div className="relative">
          <Search
            size={16}
            strokeWidth={2.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-asphalt-500"
            aria-hidden="true"
          />
          <input
            id="places-search"
            type="search"
            className="input py-2 pl-9 text-sm"
            placeholder="Name or OSM id"
            value={filters.query}
            onChange={(e) => set('query')(e.target.value)}
          />
        </div>
      </div>
      <div className="w-full sm:w-52">
        <label htmlFor="places-category" className="label">
          Category
        </label>
        <select
          id="places-category"
          className="input py-2 text-sm"
          value={filters.category}
          onChange={(e) => set('category')(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryOptionLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className="label" aria-hidden="true">
          Source
        </span>
        <Segmented label="Source" options={SOURCES} value={filters.source} onChange={set('source')} />
      </div>
      <div>
        <span className="label" aria-hidden="true">
          Status
        </span>
        <Segmented label="Status" options={STATUSES} value={filters.status} onChange={set('status')} />
      </div>
    </div>
  )
}
