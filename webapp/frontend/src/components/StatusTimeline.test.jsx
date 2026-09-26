import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import StatusTimeline, { STATUS_STEPS } from './StatusTimeline.jsx'

const LABELS = ['Received', 'Under review', 'Team assigned', 'In progress', 'Resolved']

function steps() {
  return within(screen.getByRole('list', { name: 'Report progress' })).getAllByRole('listitem')
}

describe('StatusTimeline', () => {
  test('is an ordered list of the five steps in order', () => {
    render(<StatusTimeline status="received" />)
    expect(screen.getByRole('list', { name: 'Report progress' }).tagName).toBe('OL')
    expect(steps().map((li) => li.textContent)).toEqual(
      LABELS.map((label) => expect.stringContaining(label)),
    )
  })

  test.each(STATUS_STEPS.map((s, i) => [s.status, i]))(
    '%s marks step %i as current, earlier done, later upcoming',
    (status, index) => {
      render(<StatusTimeline status={status} />)
      const items = steps()
      items.forEach((li, i) => {
        const expected = i < index ? 'done' : i === index ? 'current' : 'upcoming'
        expect(li).toHaveAttribute('data-state', expected)
        if (i === index) expect(li).toHaveAttribute('aria-current', 'step')
        else expect(li).not.toHaveAttribute('aria-current')
      })
      expect(items[index]).toHaveTextContent(LABELS[index])
    },
  )

  test('closed is shown as a terminal state instead of the normal path', () => {
    render(<StatusTimeline status="closed" />)
    const items = steps()
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Closed')
    expect(items[0]).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByText('Resolved')).not.toBeInTheDocument()
  })
})
