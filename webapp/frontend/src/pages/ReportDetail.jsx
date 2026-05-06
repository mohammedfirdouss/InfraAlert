import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  MapPin,
  Users,
  Clock,
  Share2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Phone,
  Image,
  FileText,
  Info,
} from 'lucide-react'
import { getReport } from '../api/client.js'
import StatusBadge from '../components/StatusBadge.jsx'
import SeverityBadge from '../components/SeverityBadge.jsx'

const TIMELINE_STEPS = [
  { key: 'pending', label: 'Received', description: 'Report submitted by citizen' },
  { key: 'analyzing', label: 'Analyzing', description: 'AI agents assessing the issue' },
  { key: 'dispatched', label: 'Dispatched', description: 'Repair team assigned and notified' },
  { key: 'in_progress', label: 'In Progress', description: 'Team on-site addressing the issue' },
  { key: 'resolved', label: 'Resolved', description: 'Issue resolved and verified' },
]

const STATUS_ORDER = ['pending', 'analyzing', 'dispatched', 'in_progress', 'resolved']

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
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

function formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function Timeline({ currentStatus }) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus)

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Clock size={15} className="text-gray-400" />
        Progress Timeline
      </h3>
      <ol className="relative space-y-0">
        {TIMELINE_STEPS.map((step, idx) => {
          const done = idx < currentIdx
          const active = idx === currentIdx
          const upcoming = idx > currentIdx

          return (
            <li key={step.key} className="relative flex gap-4">
              {/* Connector line */}
              {idx < TIMELINE_STEPS.length - 1 && (
                <div
                  className={[
                    'absolute left-[13px] top-7 w-0.5 h-full -translate-x-0.5',
                    done ? 'bg-green-400' : 'bg-gray-200',
                  ].join(' ')}
                />
              )}

              {/* Step indicator */}
              <div
                className={[
                  'relative z-10 flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center mt-0.5',
                  done
                    ? 'bg-green-500 border-green-500'
                    : active
                    ? 'bg-primary-600 border-primary-600 shadow-lg shadow-primary-600/30'
                    : 'bg-white border-gray-200',
                ].join(' ')}
              >
                {done ? (
                  <CheckCircle2 size={14} className="text-white" />
                ) : active ? (
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-gray-300" />
                )}
              </div>

              {/* Step text */}
              <div className="pb-6">
                <p
                  className={[
                    'text-sm font-semibold',
                    done
                      ? 'text-green-700'
                      : active
                      ? 'text-primary-700'
                      : 'text-gray-400',
                  ].join(' ')}
                >
                  {step.label}
                  {active && (
                    <span className="ml-2 text-xs font-normal text-primary-500">← Current</span>
                  )}
                </p>
                <p className={['text-xs mt-0.5', upcoming ? 'text-gray-300' : 'text-gray-500'].join(' ')}>
                  {step.description}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function DetailRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="p-1.5 bg-gray-100 rounded-lg shrink-0 mt-0.5">
        <Icon size={13} className="text-gray-500" />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="text-sm text-gray-900 mt-0.5">{value}</p>
      </div>
    </div>
  )
}

export default function ReportDetail() {
  const { id } = useParams()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [copied, setCopied] = useState(false)

  const fetchReport = useCallback(async () => {
    try {
      const data = await getReport(id)
      setReport(data)
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load report.')
    } finally {
      setLoading(false)
      setLastRefresh(Date.now())
    }
  }, [id])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  // Auto-refresh every 30 seconds while not resolved
  useEffect(() => {
    if (!report || report.status === 'resolved') return
    const timer = setInterval(() => {
      fetchReport()
    }, 30000)
    return () => clearInterval(timer)
  }, [report, fetchReport])

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: browser doesn't support clipboard API
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 text-gray-500 mb-6">
          <div className="w-16 h-4 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-6 animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
              <div className="h-20 bg-gray-200 rounded" />
            </div>
          </div>
          <div className="card p-5 animate-pulse h-64" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft size={15} />
          Back to Reports
        </Link>
        <div className="card p-12 text-center">
          <AlertTriangle size={36} className="mx-auto text-red-400 mb-3" />
          <h3 className="text-base font-semibold text-gray-700">Could not load report</h3>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
          <button onClick={fetchReport} className="btn-primary mt-4 inline-flex">
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!report) return null

  const typeLabel = TYPE_LABELS[report.report_type] ?? report.report_type ?? 'Unknown'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <Link
          to="/reports"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={15} />
          Back to Reports
        </Link>
        <div className="flex items-center gap-2">
          {report.status !== 'resolved' && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <RefreshCw size={11} className="animate-spin-slow" />
              Auto-refreshing
            </div>
          )}
          <button onClick={handleShare} className="btn-secondary text-xs py-1.5 px-3">
            <Share2 size={13} />
            {copied ? 'Copied!' : 'Share'}
          </button>
          <button
            onClick={() => {
              setLoading(true)
              fetchReport()
            }}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main detail card */}
        <div className="lg:col-span-2 space-y-5">
          <div className="card p-6">
            {/* Title row */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{typeLabel}</h1>
                  {report.severity && <SeverityBadge severity={report.severity} />}
                </div>
                <p className="mt-1 text-xs font-mono text-gray-400">{report.report_id}</p>
              </div>
              <StatusBadge status={report.status} />
            </div>

            {/* Priority score */}
            {report.priority_score != null && (
              <div className="mt-4 flex items-center gap-2">
                <div className="text-xs text-gray-500">AI Priority Score</div>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className={[
                      'h-2 rounded-full transition-all',
                      report.priority_score >= 8
                        ? 'bg-red-500'
                        : report.priority_score >= 5
                        ? 'bg-orange-400'
                        : 'bg-green-400',
                    ].join(' ')}
                    style={{ width: `${Math.min(report.priority_score * 10, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-700">
                  {report.priority_score.toFixed(1)}/10
                </span>
              </div>
            )}

            {/* Details */}
            <div className="mt-5 divide-y divide-gray-50">
              <DetailRow icon={MapPin} label="Location" value={report.location} />
              <DetailRow
                icon={FileText}
                label="Description"
                value={report.description}
              />
              {report.citizen_phone && (
                <DetailRow icon={Phone} label="Contact Phone" value={report.citizen_phone} />
              )}
              {report.media_urls?.length > 0 && (
                <div className="py-3 border-b border-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-gray-100 rounded-lg shrink-0">
                      <Image size={13} className="text-gray-500" />
                    </div>
                    <p className="text-xs font-medium text-gray-500">Photo Evidence</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {report.media_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-600 hover:underline break-all"
                      >
                        Photo {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <DetailRow
                icon={Clock}
                label="Submitted"
                value={`${formatDate(report.created_at)} (${timeAgo(report.created_at)})`}
              />
              <DetailRow
                icon={Clock}
                label="Last Updated"
                value={formatDate(report.updated_at)}
              />
            </div>
          </div>

          {/* Analysis notes */}
          {report.analysis_notes && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Info size={15} className="text-primary-500" />
                AI Analysis Notes
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed">{report.analysis_notes}</p>
            </div>
          )}

          {/* Team assignment */}
          {report.assigned_team_id && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Users size={15} className="text-gray-400" />
                Team Assignment
              </h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <Users size={18} className="text-primary-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{report.assigned_team_id}</p>
                  <p className="text-xs text-gray-500">Assigned repair team</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Timeline currentStatus={report.status} />

          {/* Last refresh notice */}
          <p className="text-xs text-center text-gray-400">
            Last checked: {new Date(lastRefresh).toLocaleTimeString()}
            {report.status !== 'resolved' && ' · refreshes every 30s'}
          </p>
        </div>
      </div>
    </div>
  )
}
