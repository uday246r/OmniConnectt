import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FormatEditorModal } from './FormatEditorModal'
import type { CustomPreset } from '@omniconnect/ui/validation'

/**
 * The "Add Format" / "Edit Format" builder — Settings > Manage Formats. Every reusable format a
 * company defines (a custom regex, a character-length range, a numeric range, or a plain-language
 * "text type") is only ever created or edited through this one screen, so a defect here is a defect in
 * every field that references the format it produces.
 */

// Both dropdowns are the shared searchable Select, labelled by their visible <label>s.
function formatTypeSelect() {
  return screen.getByRole('combobox', { name: 'Format Type' })
}
function allowedCharactersSelect() {
  return screen.getByRole('combobox', { name: 'Allowed characters' })
}
/** Opens a dropdown and clicks the option with this label. */
function choose(combobox: HTMLElement, label: string) {
  fireEvent.mouseDown(combobox)
  fireEvent.click(screen.getByRole('option', { name: label }))
}

function renderModal(props: Partial<Parameters<typeof FormatEditorModal>[0]> = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <FormatEditorModal
      open
      preset={null}
      existingKeys={['employeeIdRange']}
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

  it('defaults to the Text / String Type kind — the friendliest option for a non-technical admin', () => {
    renderModal()

    expect(formatTypeSelect()).toHaveValue('Text / String Type')
    expect(allowedCharactersSelect()).toBeInTheDocument()
  })

  it('titles itself with the formats label when editing', () => {
    const preset: CustomPreset = { key: 'employeeIdRange', label: 'Employee ID Range', kind: 'numericRange', minValue: 1000, maxValue: 5000, message: 'Out of range.' }

    renderModal({ preset })

    expect(screen.getByRole('heading', { name: 'Edit "Employee ID Range"' })).toBeInTheDocument()
  })
})

describe('the internal key', () => {
  it('is derived from the label as the admin types', async () => {
    renderModal()

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Company Name Text')

    // "Internal ID: " and the derived key are sibling text nodes in the same <span> — a substring
    // regex against the hint's combined text, not an exact match on just the key.
    expect(screen.getByText(/internal id:\s*companyNameText/i)).toBeInTheDocument()
  })
})

describe('switching format type reveals the right fields', () => {
  it('regex shows a pattern input', async () => {
    renderModal()

    choose(formatTypeSelect(), 'Custom Pattern (Regex)')

    expect(screen.getByPlaceholderText('^EMP-[0-9]{4}$')).toBeInTheDocument()
  })

  it('lengthRange shows minimum and maximum character inputs', async () => {
    renderModal()

    choose(formatTypeSelect(), 'Character Length Range')

    expect(screen.getByText('Minimum characters')).toBeInTheDocument()
    expect(screen.getByText('Maximum characters')).toBeInTheDocument()
  })

  it('numericRange shows minimum and maximum value inputs with a plain-number hint', async () => {
    renderModal()

    choose(formatTypeSelect(), 'Numeric Value Range')

    expect(screen.getByText('Minimum value')).toBeInTheDocument()
    expect(screen.getByText(/read as a plain number/i)).toBeInTheDocument()
  })

  it('textPattern shows the allowed-characters dropdown, not a regex box', async () => {
    renderModal()

    choose(formatTypeSelect(), 'Custom Pattern (Regex)') // switch away first
    choose(formatTypeSelect(), 'Text / String Type')

    expect(allowedCharactersSelect()).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('^EMP-[0-9]{4}$')).not.toBeInTheDocument()
  })
})

describe('the live tester', () => {
  it('reflects a passing and a failing sample against the textPattern default (letters & spaces)', async () => {
    renderModal()
    const tester = screen.getByPlaceholderText(/type a sample value to test this format/i)

    await userEvent.type(tester, 'Acme123')
    expect(screen.getByText('This value is not in the allowed format.')).toBeInTheDocument()

    await userEvent.clear(tester)
    await userEvent.type(tester, 'Acme Corp')
    expect(screen.getByText('Passes')).toBeInTheDocument()
  })

  it('reflects the numericRange bounds live as they are typed', async () => {
    renderModal()
    choose(formatTypeSelect(), 'Numeric Value Range')
    await userEvent.type(screen.getByPlaceholderText('e.g. 6000000000'), '1000')
    await userEvent.type(screen.getByPlaceholderText('e.g. 9999999999'), '5000')

    const tester = screen.getByPlaceholderText(/type a sample value to test this format/i)
    await userEvent.type(tester, '8000')
    expect(screen.getByText('This value is not in the allowed format.')).toBeInTheDocument()

    await userEvent.clear(tester)
    await userEvent.type(tester, '3000')
    expect(screen.getByText('Passes')).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('refuses to save with no label', async () => {
    const { onSave } = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Label is required.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a label whose derived key already exists', async () => {
    const { onSave } = renderModal({ existingKeys: ['employeeIdRange'] })

    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Employee Id Range')
    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses an empty regex pattern', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Employee Code')
    choose(formatTypeSelect(), 'Custom Pattern (Regex)')

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/enter a regular expression/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a syntactically invalid regex pattern', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Employee Code')
    choose(formatTypeSelect(), 'Custom Pattern (Regex)')
    // fireEvent.change, not userEvent.type: userEvent parses "{" and "[" as key-sequence syntax.
    fireEvent.change(screen.getByPlaceholderText('^EMP-[0-9]{4}$'), { target: { value: '[unclosed' } })

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid regular expression syntax/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a lengthRange with neither bound set', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Code Length')
    choose(formatTypeSelect(), 'Character Length Range')

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/minimum and\/or maximum length/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a numericRange where minimum exceeds maximum', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Range')
    choose(formatTypeSelect(), 'Numeric Value Range')
    await userEvent.type(screen.getByPlaceholderText('e.g. 6000000000'), '100')
    await userEvent.type(screen.getByPlaceholderText('e.g. 9999999999'), '10')

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/minimum value cannot exceed maximum value/i)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with the assembled preset on a valid textPattern submission', async () => {
    const { onSave } = renderModal()
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. employee code/i), 'Company Name Text')
    choose(allowedCharactersSelect(), 'Letters & spaces')

    await userEvent.click(screen.getByRole('button', { name: 'Add Format' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'companyNameText',
        label: 'Company Name Text',
        kind: 'textPattern',
        textMode: 'lettersAndSpaces',
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
