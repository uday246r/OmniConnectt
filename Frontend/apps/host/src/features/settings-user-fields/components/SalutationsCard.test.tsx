import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SalutationsCard } from './SalutationsCard'
import { useAuthStore } from '../../auth/store/authStore'
import { salutationsApi } from '../api/salutationsApi'

/**
 * The one place an admin manages the salutation list (Mr., Ms., ...) — see the component's own doc
 * comment. Getting the add/remove/save flow wrong here means either the dropdown on Create/Edit User
 * silently drifts from what was "saved" (dirty-state bug) or a duplicate slips in that renders as two
 * indistinguishable options in that dropdown.
 */

vi.mock('../api/salutationsApi', () => ({
  salutationsApi: { get: vi.fn(), update: vi.fn() },
}))

const mockGet = vi.mocked(salutationsApi.get)
const mockUpdate = vi.mocked(salutationsApi.update)

function catalog(salutations: string[], version = 1) {
  return { salutations, version, updatedAt: new Date().toISOString() }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ accessToken: 'test-token' })
  mockGet.mockResolvedValue(catalog(['Mr.', 'Ms.', 'Mrs.', 'Dr.']))
})

describe('loading', () => {
  it('shows every salutation once loaded', async () => {
    render(<SalutationsCard canEdit />)

    expect(await screen.findByText('Mr.')).toBeInTheDocument()
    expect(screen.getByText('Ms.')).toBeInTheDocument()
    expect(screen.getByText('Dr.')).toBeInTheDocument()
  })

  it('reports a load failure instead of silently showing an empty list', async () => {
    mockGet.mockRejectedValue(new Error('network down'))

    render(<SalutationsCard canEdit />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load salutations.')
  })
})

describe('read-only mode', () => {
  it('hides Save Changes, Add, and every remove button when the viewer cannot edit', async () => {
    render(<SalutationsCard canEdit={false} />)

    await screen.findByText('Mr.')

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove mr\./i })).not.toBeInTheDocument()
  })
})

describe('adding', () => {
  it('adds a new salutation as a chip and marks the form dirty', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.type(screen.getByPlaceholderText('e.g. Prof.'), 'Prof.')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByText('Prof.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('adding via Enter works the same as clicking Add', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.type(screen.getByPlaceholderText('e.g. Prof.'), 'Prof.{Enter}')

    expect(screen.getByText('Prof.')).toBeInTheDocument()
  })

  it('refuses a case-insensitive duplicate', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.type(screen.getByPlaceholderText('e.g. Prof.'), 'MR.')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/already in the list/i)
    // Still exactly one "Mr." chip — the duplicate was never added.
    expect(screen.getAllByText(/^mr\.$/i)).toHaveLength(1)
  })

  it('does nothing for a blank/whitespace-only entry', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.type(screen.getByPlaceholderText('e.g. Prof.'), '   ')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })
})

describe('removing', () => {
  it('removes a chip and marks the form dirty', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.click(screen.getByRole('button', { name: /remove mr\./i }))

    expect(screen.queryByText(/^mr\.$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })
})

describe('saving', () => {
  it('is disabled until something actually changed', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('sends the current in-memory list and reflects the servers response', async () => {
    mockUpdate.mockResolvedValue(catalog(['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'], 2))
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.type(screen.getByPlaceholderText('e.g. Prof.'), 'Prof.')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('test-token', { salutations: ['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'] })
    })
    // Dirty state clears once the save round-trips successfully.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})
