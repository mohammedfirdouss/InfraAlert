/** Test data for the incident page (imported by tests only). */

export const INCIDENT_ID = '1a2b3c4d-0000-4000-8000-000000000001'
export const OTHER_ID = '9f8e7d6c-0000-4000-8000-000000000002'
export const BUSY_ELSEWHERE_ID = 'abcdef12-0000-4000-8000-000000000003'

export const TEAMS = {
  roads1: { id: 't-roads-1', name: 'Roads 1', skilled: true, busy_with_incident_id: null, distance_m: 850, suggested: true },
  roads2: { id: 't-roads-2', name: 'Roads 2', skilled: true, busy_with_incident_id: null, distance_m: 2400, suggested: false },
  water1: { id: 't-water-1', name: 'Water 1', skilled: false, busy_with_incident_id: null, distance_m: 300, suggested: false },
  roads3: { id: 't-roads-3', name: 'Roads 3', skilled: true, busy_with_incident_id: BUSY_ELSEWHERE_ID, distance_m: 120, suggested: false },
}

export function report(overrides = {}) {
  return {
    id: 'r-1',
    description: 'Huge pothole in the right lane, cars swerving.',
    address_text: '12 Marina Road',
    location: { lat: 6.4541, lng: 3.3947 },
    submitted_at: '2026-09-26T08:00:00Z',
    processing: 'processed',
    issue_type: 'pothole',
    hazard_flags: ['blocking_traffic'],
    summary: 'Large pothole blocking the right lane.',
    confidence: 0.91,
    photos: [],
    ...overrides,
  }
}

export function detail(overrides = {}, itemOverrides = {}) {
  const item = {
    id: INCIDENT_ID,
    status: 'triaged',
    issue_type: 'pothole',
    priority_score: 0.52,
    severity: 'MEDIUM',
    report_count: 2,
    hazard_flags: ['blocking_traffic'],
    headline: 'Large pothole blocking the right lane.',
    address_text: '12 Marina Road',
    location: { lat: 6.4541, lng: 3.3947 },
    created_at: '2026-09-26T08:00:00Z',
    suggested_team: { id: TEAMS.roads1.id, name: 'Roads 1' },
    assigned_team: null,
    ...itemOverrides,
  }
  return {
    item,
    formula_version: 'v1',
    priority_inputs: {
      issue_type: 'pothole',
      hazard_flags: ['blocking_traffic'],
      report_count: 2,
      nearby_places: [{ category: 'school', distance_m: 120 }],
      components: {
        hazard: { value: 0.6, weight: 0.35, contribution: 0.21 },
        type: { value: 0.5, weight: 0.3, contribution: 0.15 },
        place: { value: 0.54, weight: 0.2, contribution: 0.108 },
        volume: { value: 0.25, weight: 0.15, contribution: 0.0375 },
      },
      floor_applied: false,
    },
    merged_into_id: null,
    resolved_at: null,
    reports: [
      report(),
      report({
        id: 'r-2',
        description: 'Deep hole near the school gate.',
        submitted_at: '2026-09-26T09:00:00Z',
        confidence: 0.42,
        summary: 'Pothole near a school.',
        hazard_flags: [],
      }),
    ],
    assignments: [],
    audit: [],
    ...overrides,
  }
}

export function response({ incident = detail(), teams = Object.values(TEAMS), nearby } = {}) {
  return {
    incident,
    candidate_teams: teams,
    nearby_incidents: nearby ?? [
      {
        id: OTHER_ID,
        issue_type: 'pothole',
        status: 'triaged',
        distance_m: 40,
        report_count: 3,
        headline: 'Pothole outside the bakery',
        location: { lat: 6.4544, lng: 3.3949 },
      },
    ],
  }
}
