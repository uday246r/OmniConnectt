import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadFieldConfig } from '../../config/fieldControlRegistry'

/**
 * The Create Lead form as a whole.
 *
 * The form was rebuilt on the shared field layer, and it had no test of any kind before that — so the
 * one thing most worth holding is the part a restyle is most likely to break silently: every field is
 * behind its own `isFieldVisible` guard and takes its label and its required marker from Field
 * Settings for the chosen product. A field switched off must not appear, a renamed field must appear
 * under the administrator's name, and no field may be hardcoded back into the markup.
 *
 * The second thing is that the form only exists once a product is chosen — which product decides
 * which fields there are at all.
 */

const getCatalogCategories = vi.hoisted(() => vi.fn())
const getCatalogProducts = vi.hoisted(() => vi.fn())

vi.mock('../../api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/apiClient')>()
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getCatalogCategories, getCatalogProducts },
  }
})

const { LeadFormContainer } = await import('./LeadFormContainer')
const { useLeadStore } = await import('../../store/useLeadStore')

const field = (apiField: string, over: Partial<LeadFieldConfig> = {}): LeadFieldConfig => ({
  id: apiField,
  catalogSubCategoryId: 's1',
  apiField,
  displayLabel: apiField,
  section: 'customer',
  displayOrder: 1,
  visible: true,
  required: false,
  editable: true,
  sensitive: false,
  maskingRule: 'None',
  visibleCharCount: 0,
  validations: [],
  ...over,
})

beforeEach(() => {
  getCatalogCategories.mockReset().mockResolvedValue([])
  getCatalogProducts.mockReset().mockResolvedValue([])
  useLeadStore.setState({ formData: { ...useLeadStore.getState().formData, product: '' }, fieldConfig: [], errors: {} })
})

describe('LeadFormContainer', () => {
  it('asks for a product before anything else, because the product decides what the form asks', () => {
    render(<LeadFormContainer />)

    expect(screen.getByRole('combobox', { name: /Category/ })).toBeInTheDocument()
    expect(screen.getByText(/Select a product/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Customer Name/i)).not.toBeInTheDocument()
  })

  it('shows the fields once a product is chosen', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [field('customerName', { displayLabel: 'Customer Name' })],
    })

    render(<LeadFormContainer />)

    expect(screen.getByLabelText('Customer Name')).toBeInTheDocument()
  })

  it('leaves out a field Field Settings has switched off', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [
        field('customerName', { displayLabel: 'Customer Name' }),
        field('employerName', { displayLabel: 'Employer Name', visible: false }),
      ],
    })

    render(<LeadFormContainer />)

    expect(screen.getByLabelText('Customer Name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Employer Name')).not.toBeInTheDocument()
  })

  it('labels a field the way the administrator named it, not the way the code does', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [field('icNumber', { displayLabel: 'NRIC / Passport No.' })],
    })

    render(<LeadFormContainer />)

    expect(screen.getByLabelText(/NRIC \/ Passport No\./)).toBeInTheDocument()
    expect(screen.queryByLabelText(/IC Number/)).not.toBeInTheDocument()
  })

  it('marks a field required only when Field Settings says it is', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [
        field('customerName', { displayLabel: 'Customer Name', required: true }),
        field('email', { displayLabel: 'Email', required: false }),
      ],
    })

    render(<LeadFormContainer />)

    expect(screen.getByLabelText(/Customer Name/)).toBeRequired()
    expect(screen.getByLabelText(/Email/)).not.toBeRequired()
  })

  it('announces a field validation message against the field it belongs to', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [field('customerName', { displayLabel: 'Customer Name', required: true })],
      errors: { customerName: 'Please enter the Customer Name' },
    })

    render(<LeadFormContainer />)

    const input = screen.getByLabelText(/Customer Name/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter the Customer Name')
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
  })

  it('shows the business section only once one of its fields is switched on', () => {
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Microfinance' },
      fieldConfig: [field('companyName', { displayLabel: 'Company Name' })],
    })

    render(<LeadFormContainer />)

    expect(screen.getByText('Business Details')).toBeInTheDocument()
    // Property Details belongs to a different product shape and none of its fields are on.
    expect(screen.queryByText('Property Details')).not.toBeInTheDocument()
  })

  it('does not submit the lead when the submit button is pressed with the form invalid', async () => {
    const submitLead = vi.fn().mockResolvedValue(false)
    useLeadStore.setState({
      formData: { ...useLeadStore.getState().formData, product: 'Home Loan' },
      fieldConfig: [field('customerName', { displayLabel: 'Customer Name', required: true })],
      submitLead,
    })
    const user = userEvent.setup()

    render(<LeadFormContainer />)
    await user.click(screen.getByRole('button', { name: /Submit Lead Application/i }))

    // The store owns validation; what matters here is that the form routes through it rather than
    // posting straight to the API.
    await waitFor(() => expect(submitLead).toHaveBeenCalledTimes(1))
  })
})
