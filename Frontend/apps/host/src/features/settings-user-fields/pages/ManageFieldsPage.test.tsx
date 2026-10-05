import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldDefinition } from '@omniconnect/ui/validation'
import { ManageFieldsPage } from './ManageFieldsPage'
import { useAuthStore } from '../../auth/store/authStore'

/**
 * The screen where an admin lays out the user form. What is worth pinning is the part that is easy to
 * get subtly wrong and expensive to discover later: order is PER SECTION, moving a field within a
 * section must not disturb its neighbours in other sections, moving it between sections must change
 * only its section, and nothing reaches the server until Save.
 */

const mockUserSchemaApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
const mockFieldSectionsApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
const mockCustomPresetsApi = vi.hoisted(() => ({ get: vi.fn() }))
const mockFieldTemplatesApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
const mockSalutationsApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))

vi.mock('../api/userSchemaApi', () => ({ userSchemaApi: mockUserSchemaApi }))
vi.mock('../api/fieldSectionsApi', () => ({ fieldSectionsApi: mockFieldSectionsApi }))
vi.mock('../api/customPresetsApi', () => ({ customPresetsApi: mockCustomPresetsApi }))
vi.mock('../api/fieldTemplatesApi', () => ({ fieldTemplatesApi: mockFieldTemplatesApi }))
vi.mock('../api/salutationsApi', () => ({ salutationsApi: mockSalutationsApi }))

const sections = [
  { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
  { key: 'address', label: 'Address', order: 2, isSystem: false },
  { key: 'employment', label: 'Employment Details', order: 3, isSystem: false },
]

const core = (key: string, order: number): FieldDefinition => ({
  key, label: key, core: true, dataType: key === 'email' ? 'email' : 'text', required: true, order, validations: [],
  section: 'personal-details',
})

const custom = (key: string, order: number, section: string): FieldDefinition => ({
  key, label: `Label ${key}`, core: false, dataType: 'text', required: false, order, validations: [], section,
})

const now = () => new Date().toISOString()

function seed(fields: FieldDefinition[]) {
  mockUserSchemaApi.get.mockResolvedValue({ fields, version: 7, updatedAt: now() })
}

/** Custom-field labels in the order the list shows them, top to bottom. */
const listedLabels = () =>
  screen.getAllByText(/^Label /).map((el) => el.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  // The real loader hits the network and, failing, signs the user out a few hundred ms in — which
  // would strip the edit controls out from under any test slow enough to still be running.
  useAuthStore.setState({ loadFineCapabilities: () => Promise.resolve() })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    accessTokenExpiresAt: Date.now() + 3600_000,
    user: { id: 'u-admin', name: 'Admin', email: 'a@x.com', roleName: 'Administrator', isAdministrator: true, permissions: [] } as never,
  })

  mockFieldSectionsApi.get.mockResolvedValue({ sections, version: 3, updatedAt: now() })
  mockCustomPresetsApi.get.mockResolvedValue({ presets: [], version: 1, updatedAt: now() })
  mockFieldTemplatesApi.get.mockResolvedValue({ templates: [], version: 1, updatedAt: now() })
  mockSalutationsApi.get.mockResolvedValue({ salutations: [], version: 1, updatedAt: now(), entries: [] })
  mockUserSchemaApi.update.mockImplementation(async (_t: string, body: { fields: FieldDefinition[] }) => ({
    fields: body.fields, version: 8, updatedAt: now(),
  }))

  seed([
    core('name', 1), core('email', 2), core('phoneNumber', 3),
    custom('street', 1, 'address'),
    custom('city', 2, 'address'),
    custom('employer', 1, 'employment'),
  ])
})

describe('grouping', () => {
  it('lists custom fields under their section headings in catalog order', async () => {
    render(<ManageFieldsPage />)

    await screen.findByText('Label street')

    const headings = screen.getAllByText(/^(Personal Details|Address|Employment Details)$/, { selector: 'span' })
      .map((h) => h.textContent)
    expect(headings.indexOf('Address')).toBeLessThan(headings.indexOf('Employment Details'))
    expect(listedLabels()).toEqual(['Label street', 'Label city', 'Label employer'])
  })

  it('shows an empty section to an editor with an Add field button, so its first field can be added', async () => {
    render(<ManageFieldsPage />)

    await screen.findByText('Label street')

    expect(screen.getByText('No custom fields in this section yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add a field to personal details/i })).toBeInTheDocument()
  })

  it('has a Sections tab and no Password Policies tab — that now lives on its own page', async () => {
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    expect(screen.getByRole('tab', { name: /sections/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /password polic/i })).not.toBeInTheDocument()
  })
})

describe('reordering within a section', () => {
  it('moves a field down and back up without touching the saved schema until Save', async () => {
    const user = userEvent.setup()
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    await user.click(screen.getByRole('button', { name: 'Move Label street down' }))

    expect(listedLabels()).toEqual(['Label city', 'Label street', 'Label employer'])
    expect(mockUserSchemaApi.update).not.toHaveBeenCalled()
    expect(screen.getByText(/unsaved changes to the field schema/i)).toBeInTheDocument()
  })

  it('cannot move the first field of a section up or the last one down', async () => {
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    expect(screen.getByRole('button', { name: 'Move Label street up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Label city down' })).toBeDisabled()
    // A section's only field can go neither way — it must not swap with a field in another section.
    expect(screen.getByRole('button', { name: 'Move Label employer up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Label employer down' })).toBeDisabled()
  })

  it('sends per-section order numbers on save, each section counting from 1', async () => {
    const user = userEvent.setup()
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    await user.click(screen.getByRole('button', { name: 'Move Label street down' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockUserSchemaApi.update).toHaveBeenCalledTimes(1))
    const sent = mockUserSchemaApi.update.mock.calls[0][1].fields as FieldDefinition[]
    const orderIn = (section: string) => sent.filter((f) => f.section === section).map((f) => `${f.key}:${f.order}`)
    expect(orderIn('address')).toEqual(['city:1', 'street:2'])
    expect(orderIn('employment')).toEqual(['employer:1'])
    expect(orderIn('personal-details')).toEqual(['name:1', 'email:2', 'phoneNumber:3'])
    expect(mockUserSchemaApi.update.mock.calls[0][1].expectedVersion).toBe(7)
  })

  it('disables reordering while a filter is active, since hidden neighbours would be skipped over', async () => {
    const user = userEvent.setup()
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    await user.type(screen.getByPlaceholderText(/search by label or key/i), 'street')

    expect(screen.getByRole('button', { name: 'Move Label street down' })).toBeDisabled()
  })
})

describe('moving a field between sections', () => {
  it('changes only its section, placing it last in the destination', async () => {
    const user = userEvent.setup()
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    const combo = screen.getByRole('combobox', { name: 'Section for Label street' })
    fireEvent.mouseDown(combo)
    await user.click(await screen.findByRole('option', { name: 'Employment Details' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockUserSchemaApi.update).toHaveBeenCalledTimes(1))
    const sent = mockUserSchemaApi.update.mock.calls[0][1].fields as FieldDefinition[]
    const street = sent.find((f) => f.key === 'street')!
    expect(street.section).toBe('employment')
    expect(street.order).toBe(2) // after employer, which was already there
    expect(street.label).toBe('Label street')
    // The section it left closes ranks rather than leaving a gap.
    expect(sent.find((f) => f.key === 'city')).toMatchObject({ section: 'address', order: 1 })
  })

  it('discarding restores the loaded layout', async () => {
    const user = userEvent.setup()
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    await user.click(screen.getByRole('button', { name: 'Move Label street down' }))
    await user.click(screen.getByRole('button', { name: /discard/i }))

    expect(listedLabels()).toEqual(['Label street', 'Label city', 'Label employer'])
    expect(screen.queryByText(/unsaved changes to the field schema/i)).not.toBeInTheDocument()
  })
})

describe('loading', () => {
  it('refuses to render a flattened layout when the section catalog cannot be loaded', async () => {
    mockFieldSectionsApi.get.mockRejectedValue(new Error('down'))

    render(<ManageFieldsPage />)

    // Failing soft here would resolve every field to the default section, and the next Save would
    // permanently flatten the whole layout.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Label street')).not.toBeInTheDocument()
  })

  it('hides every editing control from a viewer without Edit', async () => {
    useAuthStore.setState({
      user: { id: 'u-v', name: 'Viewer', email: 'v@x.com', roleName: 'Viewer', isAdministrator: false, permissions: [] } as never,
      fineCapabilities: [],
    })
    render(<ManageFieldsPage />)
    await screen.findByText('Label street')

    expect(screen.queryByRole('button', { name: 'Move Label street down' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Section for Label street' })).not.toBeInTheDocument()
    const row = screen.getByText('Label street').closest('div')!.parentElement!.parentElement!
    expect(within(row).getByText('Address')).toBeInTheDocument()
  })
})
