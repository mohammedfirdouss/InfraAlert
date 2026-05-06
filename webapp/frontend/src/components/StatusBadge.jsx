import React from 'react'

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
    dot: 'bg-gray-400',
  },
  analyzing: {
    label: 'Analyzing',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  dispatched: {
    label: 'Dispatched',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    dot: 'bg-yellow-500',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
  },
  resolved: {
    label: 'Resolved',
    className: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
  },
}

/**
 * StatusBadge — displays a report status as a coloured pill.
 * @param {{ status: string, showDot?: boolean }} props
 */
export default function StatusBadge({ status, showDot = true }) {
  const config = STATUS_CONFIG[status?.toLowerCase()] ?? {
    label: status ?? 'Unknown',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
    dot: 'bg-gray-400',
  }

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.className,
      ].join(' ')}
    >
      {showDot && (
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      )}
      {config.label}
    </span>
  )
}
