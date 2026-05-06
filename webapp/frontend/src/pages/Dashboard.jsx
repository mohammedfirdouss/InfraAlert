import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Users,
  Clock,
  FilePlus,
  MapPin,
  TrendingUp,
  Zap,
  Droplets,
  Lightbulb,
  Construction,
} from 'lucide-react'
import { getStats } from '../api/client.js'
import StatusBadge from '../components/StatusBadge.jsx'
import SeverityBadge from '../components/SeverityBadge.jsx'

const RECENT_ACTIVITY = [
  {
    id: 'RPT-002',
    type: 'Water Leak',
    location: '45 Elm Avenue, Westside',
    status: 'in_progress',
    severity: 'critical',
    timeAgo: '52 min ago',
    icon: Droplets,
    iconColor: 'text-blue-500',
    iconBg: 'bg-blue-50',
  },
  {
    id: 'RPT-004',
    type: 'Sewage Issue',
    location: '12 River Road, Eastside',
    status: 'analyzing',
    severity: 'high',
    timeAgo: '1 hr ago',
    icon: AlertTriangle,
    iconColor: 'text-orange-500',
    iconBg: 'bg-orange-50',
  },
  {
    id: 'RPT-003',
    type: 'Broken Streetlight',
    location: '78 Oak Lane, Northside',
    status: 'dispatched',
    severity: 'medium',
    timeAgo: '3 hr ago',
    icon: Lightbulb,
    iconColor: 'text-yellow-500',
    iconBg: 'bg-yellow-50',
  },
  {
    id: 'RPT-005',
    type: 'Road Damage',
    location: '200 Park Blvd, Central',
    status: 'pending',
    severity: 'low',
    timeAgo: '4 hr ago',
    icon: Construction,
    iconColor: 'text-gray-500',
    iconBg: 'bg-gray-100',
  },
  {
    id: 'RPT-001',
    type: 'Pothole',
    location: '123 Main Street, Downtown',
    status: 'resolved',
    severity: 'high',
    timeAgo: '22 hr ago',
    icon: Zap,
    iconColor: 'text-green-500',
    iconBg: 'bg-green-50',
  },
]

function StatCard({ label, value, subtitle, icon: Icon, color, loading }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-20 bg-gray-200 rounded animate-pulse" />
          ) : (
            <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
          )}
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl ${color.replace('text-', 'bg-').replace('-600', '-50').replace('-700', '-50')}`}>
          <Icon size={20} className={color} />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((err) => setStatsError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const statCards = [
    {
      label: 'Total Reports',
      value: stats?.total_reports ?? '—',
      subtitle: 'All time',
      icon: AlertTriangle,
      color: 'text-primary-600',
    },
    {
      label: 'Resolved Today',
      value: stats?.resolved_today ?? '—',
      subtitle: 'Last 24 hours',
      icon: CheckCircle2,
      color: 'text-success-600',
    },
    {
      label: 'Active Teams',
      value: stats?.active_teams ?? '—',
      subtitle: 'Currently deployed',
      icon: Users,
      color: 'text-warning-600',
    },
    {
      label: 'Avg Response',
      value: stats ? `${stats.avg_response_hours}h` : '—',
      subtitle: 'Hours to dispatch',
      icon: Clock,
      color: 'text-purple-600',
    },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Real-time overview of infrastructure issues in your city
          </p>
        </div>
        <Link to="/report" className="btn-primary self-start sm:self-auto">
          <FilePlus size={16} />
          Report New Issue
        </Link>
      </div>

      {/* Stats error */}
      {statsError && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          Could not load live statistics — showing cached data. ({statsError})
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} loading={loading} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Recent Reports</h2>
            </div>
            <Link
              to="/reports"
              className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              View all
            </Link>
          </div>
          <ul className="divide-y divide-gray-50">
            {RECENT_ACTIVITY.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/reports/${item.id}`}
                  className="flex items-start gap-3 px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${item.iconBg}`}>
                    <item.icon size={14} className={item.iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">
                        {item.type}
                      </span>
                      <SeverityBadge severity={item.severity} />
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                      <MapPin size={10} />
                      <span className="truncate">{item.location}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <StatusBadge status={item.status} />
                    <span className="text-xs text-gray-400">{item.timeAgo}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Map placeholder */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <MapPin size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Issue Map</h2>
            </div>
            <div className="relative h-56 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex flex-col items-center justify-center gap-3">
              {/* Decorative grid */}
              <svg
                className="absolute inset-0 w-full h-full opacity-20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#6366f1" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
              {/* Fake map pins */}
              <div className="absolute top-10 left-16 w-3 h-3 bg-red-500 rounded-full shadow-lg shadow-red-500/50 animate-pulse-slow" />
              <div className="absolute top-24 right-20 w-3 h-3 bg-orange-500 rounded-full shadow-lg shadow-orange-500/50 animate-pulse-slow" />
              <div className="absolute bottom-14 left-24 w-3 h-3 bg-yellow-500 rounded-full shadow-lg shadow-yellow-500/50 animate-pulse-slow" />
              <div className="absolute bottom-10 right-16 w-2.5 h-2.5 bg-green-500 rounded-full shadow-lg shadow-green-500/50" />
              <div className="absolute top-16 left-1/2 w-2.5 h-2.5 bg-primary-500 rounded-full shadow-lg shadow-primary-500/50 animate-pulse-slow" />

              <div className="relative z-10 text-center">
                <MapPin size={28} className="text-indigo-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-indigo-700">Interactive map coming soon</p>
                <p className="text-xs text-indigo-500 mt-0.5">Powered by Google Maps</p>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                to="/report"
                className="flex items-center gap-3 p-3 rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 transition-colors group"
              >
                <div className="p-1.5 bg-primary-600 rounded-lg">
                  <FilePlus size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary-700">Submit a Report</p>
                  <p className="text-xs text-primary-500">Report infrastructure issues near you</p>
                </div>
              </Link>
              <Link
                to="/reports"
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="p-1.5 bg-gray-600 rounded-lg">
                  <CheckCircle2 size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Track Reports</p>
                  <p className="text-xs text-gray-500">View status of existing reports</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
