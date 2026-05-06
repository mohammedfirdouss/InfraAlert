import React from 'react'

const SEVERITY_CONFIG = {
  low: {
    label: 'Low',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  medium: {
    label: 'Medium',
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  },
  high: {
    label: 'High',
    className: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  critical: {
    label: 'Critical',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
}

/**
 * SeverityBadge — displays a severity level as a coloured pill.
 * @param {{ severity: string }} props
 */
export default function SeverityBadge({ severity }) {
  if (!severity) return null

  const config = SEVERITY_CONFIG[severity?.toLowerCase()] ?? {
    label: severity,
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  }

  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border uppercase tracking-wide',
        config.className,
      ].join(' ')}
    >
      {config.label}
    </span>
  )
}
