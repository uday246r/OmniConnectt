import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FieldEditorModal } from './FieldEditorModal'
import type { CustomPreset, FieldDefinition } from '@omniremit/ui/validation'

/**
 * The "Add Field" / "Edit Field" builder — the one place a non-technical admin defines what a field
 * on the Create/Edit User form is called, whether it's required, and how it's validated. A mistake
 * here (e.g. the wrong key derived from a label, or a broken regex silently accepted) doesn't just
 * break this modal — it corrupts UserFieldSchema for every future user created on the platform.
 */

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

    await userEvent.selectOptions(screen.getByRole('combobox'), 'lettersAndSpaces')

    expect(screen.getByText('Letters & spaces')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Only letters and spaces are allowed.')).toBeInTheDocument()
  })

  it('the live tester reflects a passing and a failing sample value', async () => {
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'lettersAndSpaces')

    const tester = screen.getByPlaceholderText(/type a sample value to test this rule/i)

    await userEvent.type(tester, 'Jane2')
    expect(screen.getByText('Only letters and spaces are allowed.')).toBeInTheDocument()

    await userEvent.clear(tester)
    await userEvent.type(tester, 'Jane Doe')
    expect(screen.getByText('Passes')).toBeInTheDocument()
  })

  it('a preset already added is removed from the dropdown so it cannot be added twice', async () => {
    renderModal()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'lettersAndSpaces')

    expect(screen.queryByRole('option', { name: 'Letters & spaces' })).not.toBeInTheDocument()
  })

  it('removing a rule brings its preset back into the dropdown', async () => {
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'lettersAndSpaces')

    await userEvent.click(screen.getByRole('button', { name: /remove rule/i }))

    expect(screen.getByRole('option', { name: 'Letters & spaces' })).toBeInTheDocument()
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

    expect(screen.getByRole('option', { name: 'Employee ID Range' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'employeeIdRange')

    expect(screen.getByText('Employee ID Range')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Employee ID must be between 1000 and 5000.')).toBeInTheDocument()
  })
})

describe('the one-off custom regex escape hatch', () => {
  it('shows a pattern input once selected', async () => {
    renderModal()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'custom')

    expect(screen.getByPlaceholderText('^EMP-[0-9]{4}$')).toBeInTheDocument()
  })

  it('can only be added once — it disappears from the dropdown after being added', async () => {
    renderModal()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'custom')

    expect(screen.queryByRole('option', { name: /one-off custom pattern/i })).not.toBeInTheDocument()
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
    await userEvent.selectOptions(screen.getByRole('combobox'), 'custom')

    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/needs a regular expression/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a syntactically invalid regex pattern', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. aadhar number/i), 'Employee Code')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'custom')
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
    await userEvent.selectOptions(screen.getByRole('combobox'), 'aadharFormat')

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
