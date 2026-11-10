/**
 * The issue-type enum with its label and icon, shared by the citizen status
 * page and the staff app (which re-exports it from src/staff/ui.jsx).
 */
import { CircleHelp, Construction, Droplets, Lightbulb, TriangleAlert, Waves, Zap } from 'lucide-react'

export const ISSUE_TYPES = [
  { value: 'pothole', label: 'Pothole', Icon: Construction },
  { value: 'road_damage', label: 'Road damage', Icon: TriangleAlert },
  { value: 'water_leak', label: 'Water leak', Icon: Droplets },
  { value: 'sewage', label: 'Sewage', Icon: Waves },
  { value: 'power_outage', label: 'Power outage', Icon: Zap },
  { value: 'broken_streetlight', label: 'Broken streetlight', Icon: Lightbulb },
  { value: 'other', label: 'Other', Icon: CircleHelp },
]

/** @type {Map<string, (typeof ISSUE_TYPES)[number]>} */
export const ISSUE_TYPE_BY_VALUE = new Map(ISSUE_TYPES.map((t) => [t.value, t]))
