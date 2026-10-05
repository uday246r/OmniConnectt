import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FieldEditorModal } from './FieldEditorModal'
import type { CustomPreset, FieldDefinition } from '@omniconnect/ui/validation'

/**
 * The "Add Field" / "Edit Field" builder — the one place a non-technical admin defines what a field
 * on the Create/Edit User form is called, whether it's required, and how it's validated. A mistake
 * here (e.g. the wrong key derived from a label, or a broken regex silently accepted) doesn't just
 * break this modal — it corrupts UserFieldSchema for every future user created on the platform.
 */

/** The shared rule editor's "Add a format" picker is a searchable combobox, not a native select. */
const picker = () => screen.getByRole('combobox', { name: 'Add a format' })
const openPicker = () => fireEvent.mouseDown(picker())
const closePicker = () => fireEvent.keyDown(picker(), { key: 'Escape' })
const findOption = (label: string) => screen.queryAllByRole('option').find((o) => o.textContent?.startsWith(label))
function addFormat(label: string) {
  openPicker()
  fireEvent.click(findOption(label)!)
}

function renderModal(props: Partial<Parameters<typeof FieldEditorModal>[0]> = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <FieldEditorModal
      open
      field={null}
      existingKeys={['name', 'email', 'phoneNumber']}
      customPresets={[]}
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  )
  return { onSave, onClose }
}

describe('visibility', () => {
  it('renders nothing when closed', () => {
    renderModal({ open: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('titles itself "Add Field" for a new field', () => {
    renderModal({ field: null })

    expect(screen.getByRole('heading', { name: 'Add Field' })).toBeInTheDocument()
  })

  it('titles itself with the field label when editing', () => {
    const field: FieldDefinition = { key: 'aadharNumber', label: 'Aadhar Number', core: false, dataType: 'text', required: false, order: 4, validations: [] }

    renderModal({ field })

    expect(screen.getByRole('heading', { name: 'Edit "Aadhar Number"' })).toBeInTheDocument()
  })
})

describe('the internal key', () => {
  it('is derived from the label as the admin types, camelCased', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Aadhar Number')

    // "Internal ID: " and the derived key render as sibling text nodes in the same <span>, so an
    // exact-string getByText would look for a node whose ENTIRE text is just the key — a substring
    // regex against the hint's combined text is what actually reflects what's on screen.
    expect(screen.getByText(/internal id:\s*aadharNumber/i)).toBeInTheDocument()
  })

  it('is locked and hidden for a core field, shown as protected instead', () => {
    const core: FieldDefinition = { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [] }

    renderModal({ field: core })

    expect(screen.queryByText(/internal id/i)).not.toBeInTheDocument()
    expect(screen.getByText(/can't be removed/i)).toBeInTheDocument()
  })
})

describe('required toggle', () => {
  // The toggle's <input> sits inside a <label> with no text of its own (the "Required" text is a
  // SIBLING <span>, not wrapping the input), so it carries no accessible name — and it's the only
  // checkbox this modal ever renders, so an unnamed query is unambiguous, not a workaround.
  it('is editable and defaults to checked for a new custom field', () => {
    renderModal()

    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('is forced on and disabled for a core field', () => {
    const core: FieldDefinition = { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: false, order: 1, validations: [] }

    renderModal({ field: core })

    const toggle = screen.getByRole('checkbox')
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
  })
})

describe('adding a built-in preset rule', () => {
  it('adds a rule card pre-filled with the presets default message', async () => {
    renderModal()

    addFormat('Letters & spaces')

    expect(screen.getByText('Letters & spaces')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Only letters and spaces are allowed.')).toBeInTheDocument()
  })

  it('the live tester reflects a passing and a failing sample value', async () => {
    renderModal()
    addFormat('Letters & spaces')

    const tester = screen.getByPlaceholderText(/type a sample value to try this format/i)

    await userEvent.type(tester, 'Jane2')
    expect(screen.getByRole('status')).toHaveTextContent('Only letters and spaces are allowed.')

    await userEvent.clear(tester)
    await userEvent.type(tester, 'Jane Doe')
    expect(screen.getByText(/Passes/)).toBeInTheDocument()
  })

  it('a preset already added is removed from the dropdown so it cannot be added twice', async () => {
    renderModal()

    addFormat('Letters & spaces')

    openPicker()
    expect(findOption('Letters & spaces')).toBeUndefined()
  })

  it('removing a rule brings its preset back into the dropdown', async () => {
    renderModal()
    addFormat('Letters & spaces')

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))

    openPicker()
    expect(findOption('Letters & spaces')).toBeDefined()
  })
})

describe('adding an admin-defined custom-format rule', () => {
  const employeeIdRange: CustomPreset = {
    key: 'employeeIdRange',
    label: 'Employee ID Range',
    kind: 'numericRange',
    minValue: 1000,
    maxValue: 5000,
    message: 'Employee ID must be between 1000 and 5000.',
  }

  it('appears in its own "Custom Formats" group and pre-fills its message', async () => {
    renderModal({ customPresets: [employeeIdRange] })

    openPicker()
    expect(findOption('Employee ID Range')).toBeDefined()
    closePicker()

    addFormat('Employee ID Range')

    expect(screen.getByText('Employee ID Range')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Employee ID must be between 1000 and 5000.')).toBeInTheDocument()
  })
})

describe('the one-off custom regex escape hatch', () => {
  it('shows a pattern input once selected', async () => {
    renderModal()

    addFormat('One-off custom pattern')

    expect(screen.getByPlaceholderText('^EMP-[0-9]{4}$')).toBeInTheDocument()
  })

  it('can only be added once — it disappears from the dropdown after being added', async () => {
    renderModal()

    addFormat('One-off custom pattern')

    openPicker()
    expect(findOption('One-off custom pattern')).toBeUndefined()
  })
})

describe('saving', () => {
  it('refuses to save with no label', async () => {
    const { onSave } = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Label is required.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a label whose derived key already exists on another field', async () => {
    const { onSave } = renderModal({ existingKeys: ['name', 'email', 'phoneNumber', 'aadharNumber'] })

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Aadhar Number')
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses an empty pattern on a one-off custom regex rule', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Employee Code')
    addFormat('One-off custom pattern')

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/needs a regular expression/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a syntactically invalid regex pattern', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Employee Code')
    addFormat('One-off custom pattern')
    // fireEvent.change, not userEvent.type: userEvent parses "{" and "[" as key-sequence syntax, and
    // a raw invalid-regex string like this one is exactly what a real admin could paste in anyway.
    fireEvent.change(screen.getByPlaceholderText('^EMP-[0-9]{4}$'), { target: { value: '[unclosed' } })

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid regular expression syntax/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with the assembled field on a valid submission', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Aadhar Number')
    addFormat('Aadhar number')

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'aadharNumber',
        label: 'Aadhar Number',
        core: false,
        required: true,
        validations: [expect.objectContaining({ type: 'aadharFormat' })],
      }),
    )
  })

  it('cancel closes without saving', async () => {
    const { onSave, onClose } = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('templates and dropdown fields', () => {
  it('switches to dropdown and rejects saving with no options', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Department')
    const dropdownBtn = screen.getByRole('radio', { name: /dropdown/i })
    await userEvent.click(dropdownBtn)

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/dropdown fields require at least one option/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows adding and removing custom options for a dropdown field', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Priority')
    await userEvent.click(screen.getByRole('radio', { name: /dropdown/i }))

    const optionInput = screen.getByPlaceholderText(/add option and press enter/i)
    await userEvent.type(optionInput, 'High')
    await userEvent.click(screen.getByRole('button', { name: 'Add Option' }))

    expect(screen.getByText('High')).toBeInTheDocument()

    await userEvent.type(optionInput, 'Low')
    fireEvent.keyDown(optionInput, { key: 'Enter' })

    expect(screen.getByText('Low')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'priority',
        label: 'Priority',
        dataType: 'dropdown',
        options: ['High', 'Low'],
        validations: [],
      }),
    )
  })

  it('choosing the Country template auto-populates country label and 240+ countries', async () => {
    const { onSave } = renderModal()

    const templateCombobox = screen.getByRole('combobox', { name: /template \(pre-configured\)/i })
    fireEvent.mouseDown(templateCombobox)
    const countryOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('Country'))
    expect(countryOption).toBeDefined()
    fireEvent.click(countryOption!)

    expect(screen.getByDisplayValue('Country')).toBeInTheDocument()
    expect(screen.getByText(/250 options/i)).toBeInTheDocument()
    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('United States')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'country',
        label: 'Country',
        dataType: 'dropdown',
        template: 'contact-country',
        options: expect.arrayContaining(['India', 'United States', 'United Kingdom']),
      }),
    )
  })
})

describe('form section', () => {
  const sections = [
    { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
    { key: 'address', label: 'Address', order: 2, isSystem: false },
    { key: 'employment', label: 'Employment Details', order: 3, isSystem: false },
  ]
  const sectionSelect = () => screen.getByRole('combobox', { name: /form section/i })

  it('offers exactly the admin-managed sections, by label, with no free-text escape hatch', () => {
    renderModal({ sections })

    fireEvent.mouseDown(sectionSelect())

    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Personal Details', 'Address', 'Employment Details']))
    expect(labels.some((l) => l?.includes('Custom Section'))).toBe(false)
  })

  it('preselects the section whose Add Field was clicked and saves its KEY, not its label', async () => {
    const { onSave } = renderModal({ sections, initialSection: 'employment' })
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Employer')
    addFormat('Aadhar number')

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ key: 'employer', section: 'employment' }))
  })

  it('shows an existing field in its real section even when it stored an old label', async () => {
    const legacy: FieldDefinition = {
      key: 'street', label: 'Street', core: false, dataType: 'text', required: false, order: 1, validations: [],
      section: 'Address',
    }
    const { onSave } = renderModal({ sections, field: legacy })

    await userEvent.click(screen.getByRole('button', { name: 'Save Field' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ section: 'address' }))
  })

  it('falls back to the default section for a field pointing at a section that was deleted', async () => {
    const orphan: FieldDefinition = {
      key: 'lost', label: 'Lost', core: false, dataType: 'text', required: false, order: 1, validations: [],
      section: 'deleted-section',
    }
    const { onSave } = renderModal({ sections, field: orphan })

    await userEvent.click(screen.getByRole('button', { name: 'Save Field' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ section: 'personal-details' }))
  })

  it('hides the section picker for a core field, whose placement is not the admin\'s to change', () => {
    const core: FieldDefinition = {
      key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1, validations: [],
      section: 'personal-details',
    }
    renderModal({ sections, field: core })

    expect(screen.queryByRole('combobox', { name: /form section/i })).not.toBeInTheDocument()
  })
})
