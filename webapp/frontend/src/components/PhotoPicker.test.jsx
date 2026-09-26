import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoPicker from './PhotoPicker.jsx'
import { ApiError, MAX_PHOTO_BYTES, requestUpload, uploadPhoto } from '../api/client.js'

vi.mock('../api/client.js', async (importActual) => ({
  ...(await importActual()),
  requestUpload: vi.fn(),
  uploadPhoto: vi.fn(),
}))

/** Controllable uploadPhoto calls, in call order. */
let uploads
let counter

function deferredUpload(target, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const entry = { target, file, onProgress, signal, resolve, reject }
    uploads.push(entry)
    signal?.addEventListener('abort', () =>
      reject(new DOMException('Upload aborted', 'AbortError')),
    )
  })
}

beforeEach(() => {
  uploads = []
  counter = 0
  requestUpload.mockReset()
  uploadPhoto.mockReset()
  requestUpload.mockImplementation(async (contentType) => ({
    object_name: `uploads/obj-${++counter}`,
    upload_url: `https://storage.example/${counter}`,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
  }))
  uploadPhoto.mockImplementation(deferredUpload)
  URL.createObjectURL = vi.fn(() => `blob:preview-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  delete URL.createObjectURL
  delete URL.revokeObjectURL
})

function photo(name = 'pothole.jpg', type = 'image/jpeg', size = 1024) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** Controlled harness, as ReportForm uses it. */
function setup(props = {}) {
  const onChange = vi.fn()
  const onBusyChange = vi.fn()
  function Harness({ disabled }) {
    const [value, setValue] = useState([])
    return (
      <PhotoPicker
        value={value}
        onChange={(names) => {
          onChange(names)
          setValue(names)
        }}
        onBusyChange={onBusyChange}
        disabled={disabled}
      />
    )
  }
  const user = userEvent.setup({ applyAccept: false })
  const utils = render(<Harness {...props} />)
  return { ...utils, user, onChange, onBusyChange, Harness }
}

const input = () => screen.getByLabelText(/add photos/i)

async function waitForUploads(n) {
  await waitFor(() => expect(uploads).toHaveLength(n))
}

describe('PhotoPicker', () => {
  it('uploads a photo, shows progress, then reports its object name', async () => {
    const { user, onChange } = setup()
    const file = photo()
    await user.upload(input(), file)

    expect(requestUpload).toHaveBeenCalledWith('image/jpeg')
    await waitForUploads(1)
    expect(uploads[0].file).toBe(file)
    expect(uploads[0].target.object_name).toBe('uploads/obj-1')

    act(() => uploads[0].onProgress(0.4))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => uploads[0].resolve())
    expect(onChange).toHaveBeenLastCalledWith(['uploads/obj-1'])
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBeInTheDocument()
  })

  it('rejects oversize and wrong-type files without requesting an upload', async () => {
    const { user } = setup()
    await user.upload(input(), [
      photo('huge.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1),
      photo('notes.pdf', 'application/pdf'),
    ])
    expect(requestUpload).not.toHaveBeenCalled()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/"huge.jpg" is too large/i)
    expect(status).toHaveTextContent(/"notes.pdf" isn't a supported photo/i)
    expect(screen.queryByRole('list', { name: /photos/i })).not.toBeInTheDocument()
  })

  it('accepts a HEIC file with an empty type, without a preview', async () => {
    const { user } = setup()
    await user.upload(input(), photo('IMG_0001.HEIC', ''))
    expect(requestUpload).toHaveBeenCalledWith('image/heic')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Photo 1' }).tagName).not.toBe('IMG')
  })

  it('shows an error on failure and Retry succeeds', async () => {
    const { user, onChange, onBusyChange } = setup()
    await user.upload(input(), photo())
    await waitForUploads(1)
    await act(async () => uploads[0].reject(new ApiError(0, 'upload_failed')))

    expect(screen.getByRole('alert')).toHaveTextContent(/upload failed/i)
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /retry photo 1/i }))
    await waitForUploads(2)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    await act(async () => uploads[1].resolve())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(['uploads/obj-2'])
  })

  it('Remove aborts an in-flight upload and drops it from onChange', async () => {
    const { user, onChange } = setup()
    await user.upload(input(), [photo('a.jpg'), photo('b.png', 'image/png')])
    await waitForUploads(2)
    await act(async () => uploads[0].resolve())
    expect(onChange).toHaveBeenLastCalledWith(['uploads/obj-1'])

    await user.click(screen.getByRole('button', { name: /remove photo 2/i }))
    expect(uploads[1].signal.aborted).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove photo 1/i }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('keeps finished uploads in tile order', async () => {
    const { user, onChange } = setup()
    await user.upload(input(), [photo('a.jpg'), photo('b.jpg')])
    await waitForUploads(2)
    await act(async () => uploads[1].resolve())
    expect(onChange).toHaveBeenLastCalledWith(['uploads/obj-2'])
    await act(async () => uploads[0].resolve())
    expect(onChange).toHaveBeenLastCalledWith(['uploads/obj-1', 'uploads/obj-2'])
  })

  it('enforces the limit of 3 photos and hides the control at the limit', async () => {
    const { user } = setup()
    await user.upload(input(), [photo('1.jpg'), photo('2.jpg')])
    await user.upload(input(), [photo('3.jpg'), photo('4.jpg'), photo('5.jpg')])

    expect(requestUpload).toHaveBeenCalledTimes(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('status')).toHaveTextContent(/up to 3 photos\. 2 photos were not added/i)
    expect(screen.queryByLabelText(/add photos/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove photo 3/i }))
    expect(input()).toBeInTheDocument()
  })

  it('reports busy transitions while uploads are in flight', async () => {
    const { user, onBusyChange } = setup()
    expect(onBusyChange).not.toHaveBeenCalled()
    await user.upload(input(), [photo('a.jpg'), photo('b.jpg')])
    await waitForUploads(2)
    expect(onBusyChange.mock.calls).toEqual([[true]])

    await act(async () => uploads[0].resolve())
    expect(onBusyChange.mock.calls).toEqual([[true]])
    await act(async () => uploads[1].resolve())
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('disabled blocks adding and removing', async () => {
    const { user, rerender, Harness } = setup()
    await user.upload(input(), photo())
    await waitForUploads(1)
    rerender(<Harness disabled />)
    expect(input()).toBeDisabled()
    const list = screen.getByRole('list', { name: /photos/i })
    expect(within(list).getByRole('button', { name: /remove photo 1/i })).toBeDisabled()
  })

  it('aborts uploads and revokes previews on unmount', async () => {
    const { user, unmount, onBusyChange } = setup()
    await user.upload(input(), photo())
    await waitForUploads(1)
    unmount()
    expect(uploads[0].signal.aborted).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
})
