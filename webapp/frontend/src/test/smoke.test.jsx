import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

vi.mock('react-leaflet', () => import('./leafletStandIn.jsx'))
vi.mock('../components/TurnstileWidget.jsx', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(() => <div data-testid="turnstile" />) }
})

import App from '../App.jsx'

test('unknown routes show a not-found page', () => {
  render(
    <MemoryRouter initialEntries={['/nope']}>
      <App />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
})

test('the report form loads on demand, inside the citizen shell', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  )
  // The header is there at once; the page (and its map) arrive as their own chunk.
  expect(screen.getByRole('link', { name: 'InfraAlert home' }).closest('.on-dark')).toHaveClass('bg-ink')
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(await screen.findByRole('heading', { name: 'Where' })).toBeInTheDocument()
  expect(screen.getByTestId('map')).toBeInTheDocument()
})
