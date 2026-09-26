import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Lightbox from './Lightbox.jsx'

const photos = [
  { id: '1', url: 'https://x/1.jpg' },
  { id: '2', url: 'https://x/2.jpg' },
  { id: '3', url: 'https://x/3.jpg' },
]

function Harness({ onClose }) {
  const [index, setIndex] = useState(0)
  return <Lightbox photos={photos} index={index} onIndexChange={setIndex} onClose={onClose} />
}

describe('Lightbox', () => {
  it('focuses the close button, steps with arrows and buttons, and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Close photo' })).toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/3.jpg')
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/1.jpg')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab focus inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness onClose={() => {}} />)
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Next photo' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close photo' })).toHaveFocus()
  })
})
