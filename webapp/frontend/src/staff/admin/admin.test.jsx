import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../api/client.js'

vi.mock('react-leaflet', () => import('./leafletStandIn.jsx'))
vi.mock('../../map.js', () => ({ tileLayer: { url: 'x', attribution: 'x' }, markerIcon: {} }))

import BaseLocationPicker from './BaseLocationPicker.jsx'
import { Toasts, describeError, useToasts } from './feedback.jsx'
import { MAP_CENTRE } from './leafletStandIn.jsx'

describe('BaseLocationPicker', () => {
  function Host({ initial = null, onChange = () => {} }) {
    const [value, setValue] = useState(initial)
    return (
      <BaseLocationPicker
        value={value}
        onChange={(p) => {
          onChange(p)
          setValue(p)
        }}
      />
    )
  }

  it('starts empty, then places the pin by click and shows the readout', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Host onChange={onChange} />)
    expect(screen.getByText('No base set')).toBeInTheDocument()
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'simulate map click' }))
    expect(onChange).toHaveBeenLastCalledWith({ lat: -1.25, lng: 36.75 })
    expect(screen.getByText('-1.25000')).toBeInTheDocument()
    expect(screen.getByText('36.75000')).toBeInTheDocument()
  })

  it('moves by drag and can place at the map centre from the keyboard', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Host initial={{ lat: -1.2, lng: 36.7 }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'simulate marker drag' }))
    expect(onChange).toHaveBeenLastCalledWith({ lat: -1.26, lng: 36.76 })
    await user.click(screen.getByRole('button', { name: 'Place at map centre' }))
    expect(onChange).toHaveBeenLastCalledWith(MAP_CENTRE)
  })
})

describe('describeError', () => {
  it('maps known codes, then falls back by status', () => {
    expect(describeError(new ApiError(409, 'last_admin'), { last_admin: 'Last admin.' })).toBe('Last admin.')
    expect(describeError(new ApiError(403, 'forbidden'))).toMatch(/permission/)
    expect(describeError(new ApiError(500, null))).toMatch(/our side/)
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/couldn't reach the server/)
  })
})

describe('toasts', () => {
  function Host() {
    const { toasts, notify, dismiss } = useToasts()
    return (
      <>
        <button type="button" onClick={() => notify('Saved.')}>
          go
        </button>
        <Toasts toasts={toasts} dismiss={dismiss} />
      </>
    )
  }

  it('announces in a live region and disappears on its own', async () => {
    vi.useFakeTimers()
    try {
      render(<Host />)
      const region = screen.getByRole('status')
      expect(region).toHaveAttribute('aria-live', 'polite')
      act(() => screen.getByRole('button', { name: 'go' }).click())
      expect(region).toHaveTextContent('Saved.')
      act(() => vi.advanceTimersByTime(5000))
      expect(region).not.toHaveTextContent('Saved.')
    } finally {
      vi.useRealTimers()
    }
  })
})
