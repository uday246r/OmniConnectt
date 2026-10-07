import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'

/**
 * The field wrapper every form on the platform now uses.
 *
 * Its reason for existing is not the look — it is that the lead forms had no `htmlFor`, no `id`, no
 * `aria-invalid` and no `aria-describedby` anywhere, so a screen reader announced an unnamed box and
 * never read the error beneath it. These hold that wiring, which is invisible on screen and so would
 * otherwise rot without anyone noticing.
 */
describe('FormField', () => {
  it('names the control it wraps, so clicking the label focuses it', () => {
    render(
      <FormField label="Customer name">
        {(control) => <input {...control.aria} />}
      </FormField>,
    )

    // getByLabelText only finds it if label and control are genuinely associated.
    expect(screen.getByLabelText('Customer name')).toBeInTheDocument()
  })

  it('announces an error against the control, not just somewhere on the page', () => {
    render(
      <FormField label="Email" error="Enter a valid email address">
        {(control) => <input {...control.aria} />}
      </FormField>,
    )

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address')
  })

  it('describes the control by its hint while there is no error', () => {
    render(
      <FormField label="PAN" helper="Ten characters, letters and digits">
        {(control) => <input {...control.aria} />}
      </FormField>,
    )

    const input = screen.getByLabelText('PAN')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('replaces the hint with the error rather than reading both', () => {
    render(
      <FormField label="PAN" helper="Ten characters, letters and digits" error="Not a valid PAN">
        {(control) => <input {...control.aria} />}
      </FormField>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid PAN')
    expect(screen.queryByText('Ten characters, letters and digits')).not.toBeInTheDocument()
  })

  it('tells a combobox-style control it is invalid, which takes no aria-invalid of its own', () => {
    render(
      <FormField label="Product" error="Choose a product">
        {(control) => <span data-testid="control" data-invalid={control.invalid} />}
      </FormField>,
    )

    expect(screen.getByTestId('control')).toHaveAttribute('data-invalid', 'true')
  })

  it('falls back to a named group for a control it cannot reach inside', () => {
    render(
      <FormField label="Phone number">
        <span>prefix</span>
        <input aria-label="number" />
      </FormField>,
    )

    // No single control to point a label at, so the whole field is named instead.
    expect(screen.getByRole('group', { name: 'Phone number' })).toBeInTheDocument()
  })

  it('marks a required field for sighted and assistive users alike', () => {
    render(
      <FormField label="Mobile" required>
        {(control) => <input {...control.aria} />}
      </FormField>,
    )

    expect(screen.getByLabelText(/Mobile/)).toBeRequired()
  })
})
