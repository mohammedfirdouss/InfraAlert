import { expect, test } from 'vitest'
import {
  describeItem,
  formatAgeLong,
  formatClock,
  formatPlace,
  formatReportCount,
  parseIssueType,
  parseTab,
} from './format.js'
import { reconcile } from './useQueueData.js'

const NOW = Date.parse('2026-09-26T12:00:00Z')

const item = (overrides = {}) => ({
  id: 'i1',
  status: 'new',
  issue_type: 'pothole',
  priority_score: 0.82,
  severity: 'CRITICAL',
  report_count: 3,
  hazard_flags: [],
  headline: 'Deep pothole',
  address_text: 'Moi Avenue',
  location: { lat: -1.28333, lng: 36.81667 },
  created_at: '2026-09-26T10:00:00Z',
  suggested_team: null,
  assigned_team: null,
  ...overrides,
})

test('parses tab and issue type from the URL, with safe defaults', () => {
  expect(parseTab('triage')).toBe('triage')
  expect(parseTab('bogus')).toBe('open')
  expect(parseTab(null)).toBe('open')
  expect(parseIssueType('water_leak')).toBe('water_leak')
  expect(parseIssueType('nope')).toBeNull()
})

test('formatAgeLong mirrors formatAge in words', () => {
  expect(formatAgeLong('2026-09-26T12:00:00Z', NOW)).toBe('just now')
  expect(formatAgeLong('2026-09-26T11:59:00Z', NOW)).toBe('1 minute ago')
  expect(formatAgeLong('2026-09-26T11:48:00Z', NOW)).toBe('12 minutes ago')
  expect(formatAgeLong('2026-09-26T10:00:00Z', NOW)).toBe('2 hours ago')
  expect(formatAgeLong('2026-09-23T12:00:00Z', NOW)).toBe('3 days ago')
})

test('describes a row urgency first', () => {
  expect(describeItem(item(), NOW)).toBe('Critical, pothole, 3 reports, 2 hours ago, Moi Avenue, New')
  expect(
    describeItem(
      item({
        severity: null,
        issue_type: null,
        report_count: 1,
        hazard_flags: ['blocking_traffic', 'injury'],
        address_text: null,
        status: 'assigned',
        assigned_team: { id: 't', name: 'Roads 1' },
      }),
      NOW,
    ),
  ).toBe(
    'Unscored, unclassified, hazards: injury and blocking traffic, 1 report, 2 hours ago, -1.28333, 36.81667, Assigned, assigned to Roads 1',
  )
  expect(describeItem(item({ suggested_team: { id: 't', name: 'Roads 2' } }), NOW)).toMatch(
    /suggested team Roads 2$/,
  )
})

test('small formatters', () => {
  expect(formatReportCount(1)).toBe('×1 report')
  expect(formatReportCount(3)).toBe('×3 reports')
  expect(formatPlace(item({ address_text: null }))).toBe('-1.28333, 36.81667')
  expect(formatClock(new Date(2026, 8, 26, 9, 5))).toBe('09:05')
})

test('reconcile keeps unchanged items (and the array) as the same objects', () => {
  const a = item({ id: 'a' })
  const b = item({ id: 'b' })
  const prev = [a, b]
  expect(reconcile(prev, [{ ...a }, { ...b }])).toBe(prev)
  const next = reconcile(prev, [{ ...b, report_count: 4 }, { ...a }])
  expect(next).not.toBe(prev)
  expect(next[1]).toBe(a)
  expect(next[0]).not.toBe(b)
  expect(next[0].report_count).toBe(4)
})
