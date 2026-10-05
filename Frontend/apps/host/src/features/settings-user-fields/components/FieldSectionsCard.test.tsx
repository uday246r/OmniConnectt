import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldDefinition } from '@omniconnect/ui/validation'
import { FieldSectionsCard } from './FieldSectionsCard'
import { useAuthStore } from '../../auth/store/authStore'
import { fieldSectionsApi, type FieldSection } from '../api/fieldSectionsApi'

/**
 * The one place an admin manages form sections. The flows worth pinning are the ones that lose data if
 * wrong: a delete that strands fields, a rename that changes the key a field points at, and a save that
 * goes out while field edits are unsaved (the server would then move fields under the admin's feet).
 */

vi.mock('../api/fieldSectionsApi', () => ({
  fieldSectionsApi: { get: vi.fn(), update: vi.fn() },
}))

const mockUpdate = vi.mocked(fieldSectionsApi.update)

const sections: FieldSection[] = [
  { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
  { key: 'address', label: 'Address', order: 2, isSystem: false },
  { key: 'employment', label: 'Employment', order: 3, isSystem: false },
]

const field = (key: string, section: string): FieldDefinition => ({
  key, label: key, core: false, dataType: 'text', required: false, order: 1, validations: [], section,
})

function renderCard(overrides: Partial<React.ComponentProps<typeof FieldSectionsCard>> = {}) {
  const onSaved = vi.fn()
  render(
    <FieldSectionsCard
      canEdit
      sections={sections}
      version={4}
      fields={[field('street', 'address'), field('employer', 'employment'), field('title', 'employment')]}
      fieldsDirty={false}
      onSaved={onSaved}
      {...overrides}
    />,
  )
  return { onSaved }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ accessToken: 'test-token' })
  mockUpdate.mockImplementation(async (_token, body) => ({
    sections: body.sections.map((s, i) => ({ ...s, key: s.key || s.label.toLowerCase(), order: i + 1 })),
    version: 5,
    updatedAt: new Date().toISOString(),
  }))
})

describe('listing', () => {
  it('shows every section with how many fields it holds', () => {
    renderCard()

    expect(screen.getByText('Personal Details')).toBeInTheDocument()
    expect(screen.getByTitle('2 fields in this section')).toBeInTheDocument()
    expect(screen.getByTitle('1 field in this section')).toBeInTheDocument()
  })

  it('never offers Delete on the default section, only on the others', () => {
    renderCard()

    expect(screen.queryByRole('button', { name: /delete personal details/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete address/i })).toBeInTheDocument()
  })

  it('hides every editing control from a viewer who cannot edit', () => {
    renderCard({ canEdit: false })

    expect(screen.queryByRole('button', { name: /save sections/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add section/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rename address/i })).not.toBeInTheDocument()
  })
})

describe('adding and renaming', () => {
  it('adds a section with no key yet, leaving the server to derive it from the label', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.type(screen.getByLabelText('New section name'), 'Bank Details')
    await user.click(screen.getByRole('button', { name: /add section/i }))
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const sent = mockUpdate.mock.calls[0][1].sections
    expect(sent.at(-1)).toMatchObject({ key: '', label: 'Bank Details', order: 4 })
  })

  it('refuses a name that duplicates an existing section, ignoring case', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.type(screen.getByLabelText('New section name'), 'address')
    await user.click(screen.getByRole('button', { name: /add section/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already a section named')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('renames a section without changing its key, so its fields stay where they are', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: /rename address/i }))
    const input = screen.getByLabelText('New name for Address')
    await user.clear(input)
    await user.type(input, 'Contact & Address{Enter}')
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const renamed = mockUpdate.mock.calls[0][1].sections.find((s) => s.label === 'Contact & Address')
    expect(renamed?.key).toBe('address')
    expect(mockUpdate.mock.calls[0][1].reassignFieldsTo).toBeUndefined()
  })
})

describe('reordering', () => {
  it('moves a section up with the button and sends the new positions', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: /move employment up/i }))
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate.mock.calls[0][1].sections.map((s) => s.key)).toEqual(['personal-details', 'employment', 'address'])
    expect(mockUpdate.mock.calls[0][1].sections.map((s) => s.order)).toEqual([1, 2, 3])
  })

  it('disables Move up on the first row and Move down on the last', () => {
    renderCard()

    expect(screen.getByRole('button', { name: /move personal details up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /move employment down/i })).toBeDisabled()
  })
})

describe('deleting', () => {
  it('deletes an empty section straight away with no destination prompt', async () => {
    const user = userEvent.setup()
    renderCard({ fields: [] })

    await user.click(screen.getByRole('button', { name: /delete address/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Address')).not.toBeInTheDocument()
  })

  it('makes the admin choose where the fields go when the section still holds some', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: /delete employment/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/2 field\(s\)/)).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /move its fields to/i })).toBeInTheDocument()
  })

  it('sends the chosen destination with the save so the delete and the move commit together', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: /delete employment/i }))
    const dialog = await screen.findByRole('dialog')
    // The shared Select is a custom combobox, not a native <select>: open it, then pick the option.
    await user.click(within(dialog).getByRole('combobox', { name: /move its fields to/i }))
    await user.click(await screen.findByRole('option', { name: 'Address' }))
    await user.click(within(dialog).getByRole('button', { name: /delete section/i }))
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate.mock.calls[0][1].reassignFieldsTo).toEqual({ employment: 'address' })
    expect(mockUpdate.mock.calls[0][1].sections.map((s) => s.key)).toEqual(['personal-details', 'address'])
  })
})

describe('saving', () => {
  it('starts with Save disabled because nothing has changed', () => {
    renderCard()

    expect(screen.getByRole('button', { name: /save sections/i })).toBeDisabled()
  })

  it('blocks saving while field edits are unsaved, and says why', async () => {
    const user = userEvent.setup()
    renderCard({ fieldsDirty: true })

    await user.click(screen.getByRole('button', { name: /move employment up/i }))

    expect(screen.getByRole('button', { name: /save sections/i })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/unsaved field changes/i)
  })

  it('sends the version it loaded so a concurrent edit is refused, not overwritten', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: /move employment up/i }))
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate.mock.calls[0][1].expectedVersion).toBe(4)
  })

  it('hands the saved catalog to the page so it can reload fields the server may have moved', async () => {
    const user = userEvent.setup()
    const { onSaved } = renderCard()

    await user.click(screen.getByRole('button', { name: /move employment up/i }))
    await user.click(screen.getByRole('button', { name: /save sections/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved.mock.calls[0][0].version).toBe(5)
  })
})
