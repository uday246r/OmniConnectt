import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserFormLayer } from './UserFormLayer'
import { useAuthStore } from '../../features/auth/store/authStore'
import { ALL_COUNTRIES, FIELD_TEMPLATES } from '../../features/settings-user-fields/constants/fieldTemplates'

const mockRolesApi = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}))

const mockPermissionsApi = vi.hoisted(() => ({
  catalog: vi.fn(),
}))

const mockUserSchemaApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}))

const mockSalutationsApi = vi.hoisted(() => ({
  get: vi.fn(),
}))

const mockCustomPresetsApi = vi.hoisted(() => ({
  get: vi.fn(),
}))

const mockFieldTemplatesApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}))

const mockFieldSectionsApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../../features/settings-roles/api/rolesApi', () => ({
  rolesApi: mockRolesApi,
}))

vi.mock('../../shared/api/permissionsApi', () => ({
  permissionsApi: mockPermissionsApi,
}))

vi.mock('../../features/settings-user-fields/api/userSchemaApi', () => ({
  userSchemaApi: mockUserSchemaApi,
}))

vi.mock('../../features/settings-user-fields/api/salutationsApi', () => ({
  salutationsApi: mockSalutationsApi,
}))

vi.mock('../../features/settings-user-fields/api/customPresetsApi', () => ({
  customPresetsApi: mockCustomPresetsApi,
}))

vi.mock('../../features/settings-user-fields/api/fieldTemplatesApi', () => ({
  fieldTemplatesApi: mockFieldTemplatesApi,
}))

vi.mock('../../features/settings-user-fields/api/fieldSectionsApi', () => ({
  fieldSectionsApi: mockFieldSectionsApi,
}))

const DEFAULT_SECTIONS = [
  { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
  { key: 'address', label: 'Address', order: 2, isSystem: false },
]

/** Titles of the section cards, top to bottom — h4 is the card-title heading in this form. */
const cardTitles = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)

function renderComponent(userId?: string) {
  return render(
    <MemoryRouter initialEntries={['/settings/users']}>
      <UserFormLayer userId={userId} />
    </MemoryRouter>,
  )
}

describe('UserFormLayer - Dropdown and Searchable Combobox', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({ loadFineCapabilities: () => Promise.resolve() })
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test-token',
      accessTokenExpiresAt: Date.now() + 3600_000,
      user: {
        id: 'u-admin',
        name: 'Super Admin',
        email: 'admin@example.com',
        roleName: 'Administrator',
        isAdministrator: true,
        permissions: [],
      } as any,
      fineCapabilities: [],
    })

    mockRolesApi.list.mockResolvedValue({
      items: [
        { id: 'r-1', name: 'Analyst', isAdministrator: false, description: 'Read only' },
      ],
      totalCount: 1,
    })

    mockPermissionsApi.catalog.mockResolvedValue([])

    mockSalutationsApi.get.mockResolvedValue({
      salutations: ['Mr.', 'Ms.', 'Dr.'],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    mockCustomPresetsApi.get.mockResolvedValue({
      presets: [],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    mockFieldTemplatesApi.get.mockResolvedValue({
      templates: FIELD_TEMPLATES as any,
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    mockFieldSectionsApi.get.mockResolvedValue({
      sections: DEFAULT_SECTIONS,
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    // Schema containing core fields plus a custom dropdown (Country with ALL_COUNTRIES)
    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] },
        { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [] },
        { key: 'phoneNumber', label: 'Mobile Number', core: true, dataType: 'text', required: true, order: 3, validations: [] },
        {
          key: 'country',
          label: 'Country',
          core: false,
          dataType: 'dropdown',
          required: true,
          order: 4,
          options: ALL_COUNTRIES,
          template: 'contact-country',
          validations: [],
        },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })
  })

  it('renders dropdown custom field as a searchable Combobox with input filtering', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    // Country field should render as combobox
    const countryCombobox = screen.getByRole('combobox', { name: /^country$/i })
    expect(countryCombobox).toBeInTheDocument()

    // Type in the input box to search / filter countries
    await userEvent.type(countryCombobox, 'ind')

    // Dropdown listbox opens and shows filtered options
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    const optionLabels = options.map((o) => o.textContent)

    // Should include India, Indonesia, etc., but not France, Germany, or Brazil
    expect(optionLabels.some((l) => l?.includes('India'))).toBe(true)
    expect(optionLabels.some((l) => l?.includes('Indonesia'))).toBe(true)
    expect(optionLabels.some((l) => l?.includes('France'))).toBe(false)
    expect(optionLabels.some((l) => l?.includes('Germany'))).toBe(false)

    // Click India to select
    const indiaOption = options.find((o) => o.textContent?.trim() === 'India')
    expect(indiaOption).toBeDefined()
    fireEvent.click(indiaOption!)

    // Now value in combobox is India
    expect(countryCombobox).toHaveValue('India')
  })

  it('provides an Add Field button for admins that opens the FieldEditorModal', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    const addFieldBtn = screen.getAllByRole('button', { name: /add field/i })[0]
    expect(addFieldBtn).toBeInTheDocument()

    await userEvent.click(addFieldBtn)

    // FieldEditorModal opens with Title "Add Field"
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Add Field' })).toBeInTheDocument()
    })
  })

  it('allows adding a new dropdown field directly from user form and updating schema', async () => {
    mockUserSchemaApi.update.mockImplementation(async (_token, payload) => ({
      fields: payload.fields,
      version: 2,
      updatedAt: new Date().toISOString(),
    }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    await userEvent.click(screen.getAllByRole('button', { name: /add field/i })[0])

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add Field' })).toBeInTheDocument()
    })

    // Select the "State / Province (Contact Template)" template
    const templateCombobox = screen.getByRole('combobox', { name: /template \(pre-configured\)/i })
    fireEvent.mouseDown(templateCombobox)
    const stateOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('State / Province'))
    expect(stateOption).toBeDefined()
    fireEvent.click(stateOption!)

    // Click "Add Field" in modal footer
    const dialog = screen.getByRole('dialog')
    const modalAddBtn = within(dialog).getByRole('button', { name: 'Add Field' })
    await userEvent.click(modalAddBtn)

    await waitFor(() => {
      expect(mockUserSchemaApi.update).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: 'stateProvince',
              label: 'State / Province',
              dataType: 'dropdown',
              template: 'contact-state',
            }),
          ]),
        }),
      )
    })
  })

  it('cascades options from Country to State to City using country-state-city and resets downstream on country change', async () => {
    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] },
        { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [] },
        { key: 'phoneNumber', label: 'Mobile Number', core: true, dataType: 'text', required: false, order: 3, validations: [] },
        { key: 'country', label: 'Country', core: false, dataType: 'dropdown', required: false, order: 4, template: 'contact-country', validations: [] },
        { key: 'stateProvince', label: 'State / Province', core: false, dataType: 'dropdown', required: false, order: 5, template: 'contact-state', validations: [] },
        { key: 'city', label: 'City', core: false, dataType: 'dropdown', required: false, order: 6, template: 'contact-city', validations: [] },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    // 1. Select Country = India
    const countryCombobox = screen.getByRole('combobox', { name: /^country$/i })
    await userEvent.type(countryCombobox, 'India')
    const listbox = screen.getByRole('listbox')
    const indiaOption = within(listbox).getAllByRole('option').find((o) => o.textContent?.trim() === 'India')
    expect(indiaOption).toBeDefined()
    fireEvent.click(indiaOption!)
    expect(countryCombobox).toHaveValue('India')

    // 2. State combobox now has Indian states (e.g. Maharashtra)
    const stateCombobox = screen.getByRole('combobox', { name: /^state \/ province$/i })
    expect(stateCombobox).toBeInTheDocument()
    await userEvent.type(stateCombobox, 'Maha')
    const stateListbox = screen.getByRole('listbox')
    const mahaOption = within(stateListbox).getAllByRole('option').find((o) => o.textContent?.includes('Maharashtra'))
    expect(mahaOption).toBeDefined()
    fireEvent.click(mahaOption!)
    expect(stateCombobox).toHaveValue('Maharashtra')

    // 3. City combobox now has Maharashtra cities (e.g. Mumbai)
    const cityCombobox = screen.getByRole('combobox', { name: /^city$/i })
    expect(cityCombobox).toBeInTheDocument()
    await userEvent.type(cityCombobox, 'Mumb')
    const cityListbox = screen.getByRole('listbox')
    const mumbaiOption = within(cityListbox).getAllByRole('option').find((o) => o.textContent?.includes('Mumbai'))
    expect(mumbaiOption).toBeDefined()
    fireEvent.click(mumbaiOption!)
    expect(cityCombobox).toHaveValue('Mumbai')

    // 4. Changing country resets State and City
    await userEvent.clear(countryCombobox)
    await userEvent.type(countryCombobox, 'Germany')
    const germListbox = screen.getByRole('listbox')
    const germOption = within(germListbox).getAllByRole('option').find((o) => o.textContent?.trim() === 'Germany')
    expect(germOption).toBeDefined()
    fireEvent.click(germOption!)

    // State combobox should now be reset to empty
    const updatedStateCombobox = screen.getByRole('combobox', { name: /^state \/ province$/i })
    expect(updatedStateCombobox).toHaveValue('')
  })

  it('validates postal code dynamically based on selected country using postcode-validator', async () => {
    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] },
        { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [] },
        { key: 'phoneNumber', label: 'Mobile Number', core: true, dataType: 'text', required: false, order: 3, validations: [] },
        { key: 'country', label: 'Country', core: false, dataType: 'dropdown', required: false, order: 4, template: 'contact-country', validations: [] },
        { key: 'postalCode', label: 'Postal Code', core: false, dataType: 'text', required: false, order: 5, template: 'contact-postal-code', validations: [] },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    // Select Country = India
    const countryCombobox = screen.getByRole('combobox', { name: /^country$/i })
    await userEvent.type(countryCombobox, 'India')
    const listbox = screen.getByRole('listbox')
    const indiaOption = within(listbox).getAllByRole('option').find((o) => o.textContent?.trim() === 'India')
    fireEvent.click(indiaOption!)

    // Type invalid postal code for India (e.g. "123")
    const postalInput = screen.getByRole('textbox', { name: /^postal code$/i })
    await userEvent.type(postalInput, '123')
    fireEvent.blur(postalInput)

    // Validation error should show
    expect(screen.getByText(/invalid postal code for india/i)).toBeInTheDocument()

    // Type valid 6-digit postal code for India (e.g. "400001")
    await userEvent.clear(postalInput)
    await userEvent.type(postalInput, '400001')
    fireEvent.blur(postalInput)

    expect(screen.queryByText(/invalid postal code for india/i)).not.toBeInTheDocument()
  })

  it('validates phone number using react-phone-number-input isValidPhoneNumber', async () => {
    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] },
        { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [] },
        { key: 'phoneNumber', label: 'Mobile Number', core: true, dataType: 'text', required: false, order: 3, template: 'contact-phone', validations: [] },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    const phoneInput = screen.getByPlaceholderText('Enter phone number')
    expect(phoneInput).toBeInTheDocument()

    // Type an invalid number
    await userEvent.type(phoneInput, '1234')
    fireEvent.blur(phoneInput)

    expect(screen.getByText(/Enter a valid international phone number/i)).toBeInTheDocument()

    // Type a valid Indian phone number
    await userEvent.clear(phoneInput)
    await userEvent.type(phoneInput, '9876543210')
    fireEvent.blur(phoneInput)

    expect(screen.queryByText(/Enter a valid international phone number/i)).not.toBeInTheDocument()
  })

  it('performs live validation on all fields while typing without needing to blur or leave the form', async () => {
    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] },
        { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [] },
        { key: 'country', label: 'Country', core: false, dataType: 'dropdown', required: false, order: 3, template: 'contact-country', validations: [] },
        { key: 'postcode', label: 'Postcode', core: false, dataType: 'text', required: false, order: 4, template: 'contact-postal-code', validations: [] },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
    })

    // Initially pristine: no validation errors should be displayed
    expect(screen.queryByText(/is required/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/enter a valid email/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/invalid postal code/i)).not.toBeInTheDocument()

    // 1. Email live validation while typing (no blur called)
    const emailInput = screen.getByRole('textbox', { name: /^email address$/i })
    await userEvent.type(emailInput, 'invalid-email')
    // Error shows immediately while typing without blur
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument()

    // Finish typing valid email: error clears immediately while typing
    await userEvent.clear(emailInput)
    await userEvent.type(emailInput, 'valid@example.com')
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument()

    // 2. Select Country = India
    const countryCombobox = screen.getByRole('combobox', { name: /^country$/i })
    await userEvent.type(countryCombobox, 'India')
    const listbox = screen.getByRole('listbox')
    const indiaOption = within(listbox).getAllByRole('option').find((o) => o.textContent?.trim() === 'India')
    fireEvent.click(indiaOption!)

    // 3. Postcode live validation while typing (no blur called)
    const postcodeInput = screen.getByRole('textbox', { name: /^postcode$/i })
    await userEvent.type(postcodeInput, '560')
    // Error shows immediately on keystroke without blur
    expect(screen.getByText(/invalid postal code for india/i)).toBeInTheDocument()

    // Complete valid Indian PIN code "560001": error clears immediately while typing
    await userEvent.clear(postcodeInput)
    await userEvent.type(postcodeInput, '560001')
    expect(screen.queryByText(/invalid postal code for india/i)).not.toBeInTheDocument()

    // Space-tolerant format "560 001" also remains valid
    await userEvent.clear(postcodeInput)
    await userEvent.type(postcodeInput, '560 001')
    expect(screen.queryByText(/invalid postal code for india/i)).not.toBeInTheDocument()
  })

  it('renders the default sections and the role card, and no per-user password policy picker', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
      expect(screen.getByText('Address')).toBeInTheDocument()
      expect(screen.getByText('Assigned Role')).toBeInTheDocument()
    })

    // Password lifetime is decided by the global policy and the user's ROLE now; there is nothing to
    // choose per user, and the form must not offer a control that saves nothing.
    expect(screen.queryByText('Password Policy')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password policy template/i)).not.toBeInTheDocument()
  })

  describe('sections come from the admin-managed catalog', () => {
    const field = (key: string, label: string, order: number, section?: string) => ({
      key, label, core: false, dataType: 'text', required: false, order, validations: [], section,
    })

    function useSchema(extra: ReturnType<typeof field>[]) {
      mockUserSchemaApi.get.mockResolvedValue({
        fields: [
          { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [], section: 'personal-details' },
          { key: 'email', label: 'Email Address', core: true, dataType: 'email', required: true, order: 2, validations: [], section: 'personal-details' },
          { key: 'phoneNumber', label: 'Mobile Number', core: true, dataType: 'text', required: true, order: 3, validations: [], section: 'personal-details' },
          ...extra,
        ],
        version: 1,
        updatedAt: new Date().toISOString(),
      })
    }

    it('renders one card per section in the order the admin arranged them, not a hardcoded order', async () => {
      useSchema([field('employer', 'Employer', 1, 'employment'), field('street', 'Street', 1, 'address')])
      mockFieldSectionsApi.get.mockResolvedValue({
        sections: [
          { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
          { key: 'employment', label: 'Employment Details', order: 2, isSystem: false },
          { key: 'address', label: 'Address', order: 3, isSystem: false },
        ],
        version: 2,
        updatedAt: new Date().toISOString(),
      })

      renderComponent()
      await screen.findByText('Employment Details')

      const titles = cardTitles()
      expect(titles.indexOf('Personal Details')).toBeLessThan(titles.indexOf('Employment Details'))
      expect(titles.indexOf('Employment Details')).toBeLessThan(titles.indexOf('Address'))
    })

    it('shows a renamed section under its new label with its fields still inside it', async () => {
      useSchema([field('street', 'Street', 1, 'address')])
      mockFieldSectionsApi.get.mockResolvedValue({
        sections: [
          { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
          { key: 'address', label: 'Contact & Address', order: 2, isSystem: false },
        ],
        version: 3,
        updatedAt: new Date().toISOString(),
      })

      renderComponent()

      expect(await screen.findByText('Contact & Address')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 4, name: 'Address' })).not.toBeInTheDocument()
      expect(screen.getByLabelText(/street/i)).toBeInTheDocument()
    })

    it('still renders a field whose section was deleted, in the default section', async () => {
      useSchema([field('orphan', 'Orphaned Field', 1, 'a-section-that-was-deleted')])

      renderComponent()

      expect(await screen.findByLabelText(/orphaned field/i)).toBeInTheDocument()
    })

    it('shows an empty section to an administrator so they can add its first field', async () => {
      useSchema([])
      mockFieldSectionsApi.get.mockResolvedValue({
        sections: [
          { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
          { key: 'bank', label: 'Bank Details', order: 2, isSystem: false },
        ],
        version: 1,
        updatedAt: new Date().toISOString(),
      })

      renderComponent()

      expect(await screen.findByText('Bank Details')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add field to bank details/i })).toBeInTheDocument()
    })
  })
})
