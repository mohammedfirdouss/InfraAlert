import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BASE_URL, getReport, submitReport } from './client.js'
import { configureStaffApi, getMe, updateTeam } from '../staff/api.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
})
afterEach(() => vi.unstubAllGlobals())

const requested = () => fetch.mock.calls.map(([url]) => url)

test('the API is same-origin under /api, for citizens and staff alike', async () => {
  expect(BASE_URL).toBe('/api')
  configureStaffApi(async () => 'token', () => {})

  await submitReport({ description: 'x', location: { lat: 0, lng: 0 }, captcha_token: 't' })
  await getReport('r/1')
  await getMe()
  await updateTeam('t 1', { active: false })

  expect(requested()).toEqual(['/api/reports', '/api/reports/r%2F1', '/api/staff/me', '/api/staff/teams/t%201'])
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer token')
})
