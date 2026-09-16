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

function catalog(salutations: string[], version = 1, counts: Record<string, number> = {}) {
  return {
    salutations,
    version,
    updatedAt: new Date().toISOString(),
    entries: salutations.map((value) => ({ id: `id-${value}`, value, userCount: counts[value] ?? 0 })),
  }
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
      expect(mockUpdate).toHaveBeenCalledWith('test-token', {
        entries: [
          { id: 'id-Mr.', value: 'Mr.' },
          { id: 'id-Ms.', value: 'Ms.' },
          { id: 'id-Mrs.', value: 'Mrs.' },
          { id: 'id-Dr.', value: 'Dr.' },
          { id: '', value: 'Prof.' },
        ],
        expectedVersion: 1,
      })
    })
    // Dirty state clears once the save round-trips successfully.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})

describe('renaming', () => {
  it('keeps the entry and asks before changing the profiles that show it', async () => {
    mockGet.mockResolvedValue(catalog(['Mr', 'Ms.'], 4, { Mr: 12 }))
    mockUpdate.mockResolvedValue(catalog(['Mr.', 'Ms.'], 5, { 'Mr.': 12 }))
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr')

    await userEvent.click(screen.getByRole('button', { name: 'Edit Mr' }))
    const box = screen.getByRole('textbox', { name: 'New text for Mr' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Mr.{Enter}')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('Mr becomes Mr. on 12 user profiles.')
    expect(mockUpdate).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('test-token', {
        entries: [{ id: 'id-Mr', value: 'Mr.' }, { id: 'id-Ms.', value: 'Ms.' }],
        expectedVersion: 4,
      }),
    )
  })

  it('saves without asking when nobody has the title yet', async () => {
    mockGet.mockResolvedValue(catalog(['Mr', 'Ms.'], 1))
    mockUpdate.mockResolvedValue(catalog(['Mr.', 'Ms.'], 2))
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr')

    await userEvent.click(screen.getByRole('button', { name: 'Edit Mr' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New text for Mr' }), '.{Enter}')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuses renaming to a salutation already in the list', async () => {
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.click(screen.getByRole('button', { name: 'Edit Mrs.' }))
    const box = screen.getByRole('textbox', { name: 'New text for Mrs.' })
    await userEvent.clear(box)
    await userEvent.type(box, 'ms.{Enter}')

    expect(screen.getByRole('alert')).toHaveTextContent(/already in the list/i)
  })

  it('offers a reload when someone else saved first', async () => {
    const { ApiError } = await import('../../../shared/api/httpClient')
    mockUpdate.mockRejectedValue(new ApiError(409, 'Someone else changed the salutation list while you were editing it.'))
    render(<SalutationsCard canEdit />)
    await screen.findByText('Mr.')

    await userEvent.click(screen.getByRole('button', { name: /remove dr\./i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed')
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })
})
