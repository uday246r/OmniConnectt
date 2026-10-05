import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldTemplatesCard } from './FieldTemplatesCard'
import { fieldTemplatesApi, type FieldTemplateCatalogDto } from '../api/fieldTemplatesApi'

vi.mock('../../auth/store/authStore', () => ({
  useAuthStore: (selector: (s: { accessToken: string }) => unknown) =>
    selector({ accessToken: 'mock-token' }),
}))

vi.mock('../api/fieldTemplatesApi', () => ({
  fieldTemplatesApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../../../shared/stores/toastStore', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const mockCatalog: FieldTemplateCatalogDto = {
  version: 1,
  updatedAt: new Date().toISOString(),
  templates: [
    {
      id: 'contact-country',
      name: 'Country (Contact Template)',
      label: 'Country',
      category: 'contact',
      dataType: 'dropdown',
      description: 'Searchable dropdown containing all countries of the world',
      options: ['Afghanistan', 'Albania', 'Algeria', 'India', 'United States'],
      isSystem: true,
    },
    {
      id: 'org-department',
      name: 'Department',
      label: 'Department',
      category: 'organization',
      dataType: 'dropdown',
      description: 'Dropdown of standard business departments',
      options: ['Engineering', 'Finance', 'Human Resources', 'Sales'],
      isSystem: true,
    },
    {
      id: 'contact-state',
      name: 'State / Province (Contact Template)',
      label: 'State / Province',
      category: 'contact',
      dataType: 'dropdown',
      description: 'Cascading state/province dropdown dynamically filtered by selected country (via country-state-city)',
      options: [],
      isSystem: true,
    },
    {
      id: 'contact-city',
      name: 'City (Contact Template)',
      label: 'City',
      category: 'contact',
      dataType: 'dropdown',
      description: 'Cascading city dropdown dynamically filtered by selected state and country (via country-state-city)',
      options: [],
      isSystem: true,
    },
    {
      id: 'custom-offices',
      name: 'Office Locations',
      label: 'Office Location',
      category: 'custom',
      dataType: 'dropdown',
      description: 'Branch offices',
      options: ['New York', 'London', 'Tokyo'],
      isSystem: false,
    },
  ],
}

describe('FieldTemplatesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fieldTemplatesApi.get).mockResolvedValue(mockCatalog)
  })

  it('renders templates loaded from the database catalog', async () => {
    render(<FieldTemplatesCard canEdit />)

    expect(await screen.findByText('Country (Contact Template)')).toBeInTheDocument()
    expect(screen.getByText('Department')).toBeInTheDocument()
    expect(screen.getByText('Office Locations')).toBeInTheDocument()
    expect(screen.getByText(/pre-configured options \(5\)/i)).toBeInTheDocument()
  })

  it('filters templates by category chip', async () => {
    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Country (Contact Template)')

    const orgChip = screen.getByRole('button', { name: /organization/i })
    await userEvent.click(orgChip)

    expect(screen.getByText('Department')).toBeInTheDocument()
    expect(screen.queryByText('Country (Contact Template)')).not.toBeInTheDocument()
    expect(screen.queryByText('Office Locations')).not.toBeInTheDocument()
  })

  it('filters templates by search query', async () => {
    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Country (Contact Template)')

    const searchInput = screen.getByPlaceholderText(/search templates or options/i)
    await userEvent.type(searchInput, 'Tokyo')

    expect(screen.getByText('Office Locations')).toBeInTheDocument()
    expect(screen.queryByText('Country (Contact Template)')).not.toBeInTheDocument()
    expect(screen.queryByText('Department')).not.toBeInTheDocument()
  })

  it('opens manage options modal and allows adding and removing options', async () => {
    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Office Locations')

    // Find the Manage Options button on the custom-offices card
    const manageButtons = screen.getAllByRole('button', { name: /manage options/i })
    await userEvent.click(manageButtons[2]!) // Office Locations is the 3rd card

    expect(await screen.findByText('Manage Template: Office Locations')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Tokyo')).toBeInTheDocument()

    // Add a new option
    const addInput = within(dialog).getByPlaceholderText(/add single option or paste/i)
    await userEvent.type(addInput, 'Berlin')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Option' }))

    expect(within(dialog).getByText('Berlin')).toBeInTheDocument()

    // Remove London
    const removeLondonBtn = within(dialog).getByRole('button', { name: 'Remove London' })
    await userEvent.click(removeLondonBtn)

    expect(within(dialog).queryByText('London')).not.toBeInTheDocument()

    // Apply changes in modal
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply Changes' }))

    // Modal closes and dirty save bar appears
    expect(screen.queryByText('Manage Template: Office Locations')).not.toBeInTheDocument()
    expect(screen.getByText(/you have unsaved changes to dropdown templates/i)).toBeInTheDocument()
  })

  it('persists changes to backend when clicking Save Changes', async () => {
    vi.mocked(fieldTemplatesApi.update).mockResolvedValue({
      ...mockCatalog,
      version: 2,
    })

    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Office Locations')

    const manageButtons = screen.getAllByRole('button', { name: /manage options/i })
    await userEvent.click(manageButtons[2]!)

    const dialog = screen.getByRole('dialog')
    const addInput = within(dialog).getByPlaceholderText(/add single option or paste/i)
    await userEvent.type(addInput, 'Paris')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Option' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply Changes' }))

    // Click Save Changes
    const saveBtns = screen.getAllByRole('button', { name: 'Save Changes' })
    await userEvent.click(saveBtns[0]!)

    await waitFor(() => {
      expect(fieldTemplatesApi.update).toHaveBeenCalledWith(
        'mock-token',
        expect.objectContaining({
          expectedVersion: 1,
          templates: expect.arrayContaining([
            expect.objectContaining({
              id: 'custom-offices',
              options: ['New York', 'London', 'Tokyo', 'Paris'],
            }),
          ]),
        }),
      )
    })
  })

  it('allows creating a brand new template', async () => {
    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Country (Contact Template)')

    await userEvent.click(screen.getByRole('button', { name: 'Create Template' }))

    expect(await screen.findByText('Create New Dropdown Template')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. office locations/i), 'Payment Methods')
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. location/i), 'Payment Method')

    const addInput = screen.getByPlaceholderText(/add single option or paste/i)
    await userEvent.type(addInput, 'Credit Card, PayPal, Wire Transfer')
    await userEvent.click(screen.getByRole('button', { name: 'Add Option' }))

    expect(screen.getByText('Credit Card')).toBeInTheDocument()
    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getByText('Wire Transfer')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))

    expect(screen.getByText('Payment Methods')).toBeInTheDocument()
    expect(screen.getByText(/you have unsaved changes to dropdown templates/i)).toBeInTheDocument()
  }, 15000)

  it('protects system templates from deletion while allowing custom templates to be deleted', async () => {
    render(<FieldTemplatesCard canEdit />)

    await screen.findByText('Country (Contact Template)')

    // Only custom templates render the delete icon button
    const deleteButtons = screen.getAllByRole('button', { name: /delete template/i })
    expect(deleteButtons).toHaveLength(1) // Only Office Locations has it

    await userEvent.click(deleteButtons[0]!)

    expect(await screen.findByText(/delete template "office locations"\?/i)).toBeInTheDocument()
  })

  it('displays cascading dynamic information for contact-state and contact-city and allows editing without requiring static options', async () => {
    render(<FieldTemplatesCard canEdit />)

    expect(await screen.findByText('State / Province (Contact Template)')).toBeInTheDocument()
    expect(screen.getByText('City (Contact Template)')).toBeInTheDocument()

    // Confirms cascading badge is visible
    expect(screen.getAllByText('Cascading Dynamic Options').length).toBeGreaterThan(0)
    expect(screen.getAllByText('country-state-city').length).toBeGreaterThan(0)

    // Click "Manage Template" on State / Province
    const manageButtons = screen.getAllByRole('button', { name: /manage template/i })
    expect(manageButtons.length).toBeGreaterThan(0)
    await userEvent.click(manageButtons[0]!)

    // Dialog opens with dynamic cascading banner
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/country-state-city/i)).toBeInTheDocument()

    // Can click Apply Changes without any error even with 0 static options
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply Changes' }))
    expect(screen.queryByText('Dropdown templates require at least one option.')).not.toBeInTheDocument()
  })
})
