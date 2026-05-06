import React, { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, FilePlus, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react'
import { getReports } from '../api/client.js'
import StatusBadge from '../components/StatusBadge.jsx'
import SeverityBadge from '../components/SeverityBadge.jsx'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'analyzing', label: 'Analyzing' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
]

const TYPE_LABELS = {
  pothole: 'Pothole',
  water_leak: 'Water Leak',
  power_outage: 'Power Outage',
  broken_streetlight: 'Broken Streetlight',
  sewage: 'Sewage Issue',
  road_damage: 'Road Damage',
  other: 'Other',
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function SkeletonCard() {
  return (
    <div className="card p-4 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-gray-200 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <div className="h-4 bg-gray-200 rounded w-24" />
            <div className="h-4 bg-gray-200 rounded w-16" />
          </div>
          <div className="h-3 bg-gray-200 rounded w-48" />
          <div className="h-3 bg-gray-200 rounded w-full" />
        </div>
        <div className="h-6 bg-gray-200 rounded-full w-20 shrink-0" />
      </div>
    </div>
  )
}

function ReportCard({ report }) {
  const typeLabel = TYPE_LABELS[report.report_type] ?? report.report_type ?? 'Unknown'

  return (
    <Link
      to={`/reports/${report.report_id}`}
      className="card p-4 flex items-start gap-4 hover:shadow-md hover:border-primary-200 transition-all group"
    >
      {/* Report ID badge */}
      <div className="shrink-0 w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
        <span className="text-[10px] font-mono font-bold text-gray-500 leading-tight text-center">
          {report.report_id}
        </span>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{typeLabel}</span>
          {report.severity && <SeverityBadge severity={report.severity} />}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
          <MapPin size={10} />
          <span className="truncate">{report.location}</span>
        </div>
        {report.description && (
          <p className="mt-1.5 text-xs text-gray-600 line-clamp-2">{report.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <StatusBadge status={report.status} />
          <span className="text-xs text-gray-400">{timeAgo(report.created_at)}</span>
          {report.assigned_team_id && (
            <span className="text-xs text-gray-400">
              Team: <span className="font-medium text-gray-600">{report.assigned_team_id}</span>
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        size={16}
        className="shrink-0 text-gray-300 group-hover:text-primary-500 transition-colors mt-1"
      />
    </Link>
  )
}

export default function ReportsList() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)

  async function fetchReports(showRefresh = false) {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await getReports()
      setReports(data.reports ?? data ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load reports.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return reports
    return reports.filter((r) => r.status === filter)
  }, [reports, filter])

  const counts = useMemo(() => {
    const map = {}
    for (const r of reports) {
      map[r.status] = (map[r.status] ?? 0) + 1
    }
    return map
  }, [reports])

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            {loading ? 'Loading…' : `${reports.length} total report${reports.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchReports(true)}
            disabled={refreshing}
            className="btn-secondary"
            title="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <Link to="/report" className="btn-primary">
            <FilePlus size={14} />
            New Report
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const count = f.value === 'all' ? reports.length : (counts[f.value] ?? 0)
          const active = filter === f.value
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={[
                'shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5',
                active
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {f.label}
              {!loading && (
                <span
                  className={[
                    'px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                    active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <AlertTriangle size={36} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-base font-semibold text-gray-700">No reports found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter === 'all'
              ? 'No infrastructure reports have been submitted yet.'
              : `No reports with status "${filter}".`}
          </p>
          {filter === 'all' && (
            <Link to="/report" className="btn-primary mt-4 inline-flex">
              <FilePlus size={14} />
              Submit the First Report
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((report) => (
            <ReportCard key={report.report_id} report={report} />
          ))}
        </div>
      )}
    </div>
  )
}
