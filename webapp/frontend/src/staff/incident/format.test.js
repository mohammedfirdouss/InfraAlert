import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client.js'
import { allowedActions, describeAudit, errorMessage, parseIncidentId, shortRef, suggestedIssueType } from './format.js'

describe('shortRef', () => {
  it('uses the first 8 hex digits, upper case', () => {
    expect(shortRef('1a2b3c4d-0000-4000-8000-000000000001')).toBe('INC 1A2B3C4D')
  })
})

describe('allowedActions', () => {
  it('follows the dispatch state machine', () => {
    expect(allowedActions('new')).toMatchObject({ triage: true, assign: true, onSite: false, resolve: false, close: true })
    expect(allowedActions('assigned')).toMatchObject({ triage: false, reassign: true, onSite: true, resolve: true })
    expect(allowedActions('on_site')).toMatchObject({ assign: false, onSite: false, resolve: true, merge: true })
    for (const closed of ['resolved', 'closed_invalid', 'closed_duplicate']) {
      expect(Object.values(allowedActions(closed)).some(Boolean)).toBe(false)
    }
  })
})

describe('suggestedIssueType', () => {
  it('picks the most common extraction type, ignoring unread reports', () => {
    expect(
      suggestedIssueType([{ issue_type: 'sewage' }, { issue_type: null }, { issue_type: 'water_leak' }, { issue_type: 'water_leak' }]),
    ).toBe('water_leak')
    expect(suggestedIssueType([{ issue_type: null }])).toBeNull()
  })
})

describe('errorMessage', () => {
  it('maps codes to plain words', () => {
    expect(errorMessage(new ApiError(409, 'team_busy'), { teamName: 'Roads 1' })).toBe(
      'Roads 1 was just assigned elsewhere. Pick another team.',
    )
    expect(errorMessage(new ApiError(409, 'cannot_split_all_reports'))).toMatch(/Leave at least one report/)
    expect(errorMessage(new TypeError('fetch failed'))).toMatch(/Couldn't reach the server/)
  })
})

describe('parseIncidentId', () => {
  const known = [{ id: '9f8e7d6c-0000-4000-8000-000000000002' }]
  it('accepts a full id or a known short reference', () => {
    expect(parseIncidentId('  9F8E7D6C-0000-4000-8000-000000000002 ')).toBe(known[0].id)
    expect(parseIncidentId('INC 9F8E7D6C', known)).toBe(known[0].id)
    expect(parseIncidentId('INC 11111111', known)).toBeNull()
    expect(parseIncidentId('nonsense', known)).toBeNull()
  })
})

describe('describeAudit', () => {
  const names = { a: 'Roads 1', b: 'Roads 2' }
  const teamName = (id) => names[id] ?? 'a team'
  it('names the actor, or the system', () => {
    expect(describeAudit({ action: 'incident.on_site', staff_name: 'Dana', detail: {} }, teamName)).toMatchObject({
      actor: 'Dana',
      text: 'marked the team on site',
    })
    expect(
      describeAudit({ action: 'report.needs_triage', staff_name: null, detail: { confidence: 0.3 } }, teamName),
    ).toMatchObject({ actor: 'System', notes: ['only 30% confident'] })
  })
  it('describes reassignments and overrides', () => {
    const line = describeAudit(
      { action: 'incident.reassigned', staff_name: 'Dana', detail: { team_id: 'b', previous_team_id: 'a', overridden: true } },
      teamName,
    )
    expect(line.text).toBe('reassigned from Roads 1 to Roads 2')
    expect(line.notes).toEqual(['overrode the suggestion'])
  })
})
