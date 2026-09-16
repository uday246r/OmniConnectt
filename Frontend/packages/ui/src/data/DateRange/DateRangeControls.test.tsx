import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DateRangeColumnFilter } from './DateRangeColumnFilter'
import { DateRangeFilterButton } from './DateRangeFilterButton'
import { EMPTY_DATE_RANGE, type DateRangeValue } from './dateRange'

/*
 * Two placements of one control: a table column header, and a standalone filter-bar button. They
 * exist separately because both are genuinely in use, and they are tested together — through the
 * same describe.each — precisely because the failure mode being guarded against is them drifting
 * apart. Three hand-rolled versions of this had already done exactly that: one lost its Escape
 * handler, one lost its time inputs entirely, one anchored to a different timezone.
 */

/*
 * Plain vitest assertions rather than jest-dom matchers, matching the rest of this package.
 *
 * `tsc --noEmit` here compiles `src`, tests included — deliberately, so a shared component's tests
 * are type-checked like everything else. jest-dom's matcher augmentation does not reach that
 * compilation (vitest's own config is what loads the setup file), so `toBeInTheDocument` and friends
 * type-error even while they run green. The apps sidestep it by excluding tests from tsc; keeping
 * them in is worth more here than the matcher sugar.
 */

type Placement = {
  name: string
  render: (props: { value: DateRangeValue; onChange: (v: DateRangeValue) => void }) => void
  /** How the closed control is found — the two chrome styles label their trigger differently. */
  triggerName: RegExp
}

const placements: Placement[] = [
  {
    name: 'DateRangeColumnFilter',
    // Rendered as a <th>, so it needs a table around it to be valid markup.
    render: (props) =>
      render(
        <table>
          <thead>
            <tr>
              <DateRangeColumnFilter label="TIME" {...props} />
            </tr>
          </thead>
        </table>,
      ),
    triggerName: /time/i,
  },
  {
    name: 'DateRangeFilterButton',
    render: (props) => render(<DateRangeFilterButton label="Date Range" {...props} />),
    triggerName: /date range/i,
  },
]

describe.each(placements)('$name', ({ render: renderControl, triggerName }) => {
  function setup(value: DateRangeValue = EMPTY_DATE_RANGE) {
    const onChange = vi.fn()
    renderControl({ value, onChange })
    return { onChange, trigger: screen.getByRole('button', { name: triggerName }) }
  }

  it('opens and closes its popover from the trigger', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()

    await user.click(trigger)
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await user.click(trigger)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('closes on a click outside itself', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.click(trigger)

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  /**
   * The draft is the point: an abandoned edit must leave the applied filter alone, so nothing
   * reaches the query until Apply.
   */
  it('applies nothing until Apply is pressed', async () => {
    const user = userEvent.setup()
    const { trigger, onChange } = setup()
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Last 7 Days' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: 'week' }))
  })

  it('offers a time of day alongside each date', async () => {
    const user = userEvent.setup()
    const { trigger, onChange } = setup()
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Custom' }))

    // fireEvent rather than userEvent.type: these are date/time inputs, and userEvent parses `{`
    // and `[` in its input as key-sequence syntax.
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: '2026-09-12' } })
    fireEvent.change(screen.getByLabelText(/from time/i), { target: { value: '09:30' } })
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'custom', fromDate: '2026-09-12', fromTime: '09:30' }),
    )
  })

  /** A time with no date selects nothing, so it stays inert until there is one to attach it to. */
  it('keeps the time input inert until its date is set', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Custom' }))

    expect(screen.getByLabelText<HTMLInputElement>(/from time/i).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: '2026-09-12' } })

    expect(screen.getByLabelText<HTMLInputElement>(/from time/i).disabled).toBe(false)
  })

  it('summarises the applied range in the popover', async () => {
    const user = userEvent.setup()
    const { trigger } = setup({ preset: 'custom', fromDate: '2026-09-12', toDate: '2026-09-13' })

    await user.click(trigger)

    // getAllByText rather than getByText: the button placement also shows the range on its trigger,
    // so the summary legitimately appears twice there and exactly once in the column header.
    expect(screen.getAllByText('2026-09-12 → 2026-09-13').length).toBeGreaterThan(0)
  })

  it('resets back to no filter', async () => {
    const user = userEvent.setup()
    const { trigger, onChange } = setup({ preset: 'week' })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onChange).toHaveBeenCalledWith(EMPTY_DATE_RANGE)
  })

  it('opens showing the range currently applied, so it can be adjusted rather than retyped', async () => {
    const user = userEvent.setup()
    const { trigger } = setup({ preset: 'custom', fromDate: '2026-09-12', fromTime: '09:30' })

    await user.click(trigger)

    expect(screen.getByLabelText<HTMLInputElement>(/from date/i).value).toBe('2026-09-12')
    expect(screen.getByLabelText<HTMLInputElement>(/from time/i).value).toBe('09:30')
  })
})

describe('DateRangeColumnFilter placement', () => {
  it('renders as a table header cell so it can sit in a header row', () => {
    render(
      <table>
        <thead>
          <tr>
            <DateRangeColumnFilter label="TIME" value={EMPTY_DATE_RANGE} onChange={vi.fn()} />
          </tr>
        </thead>
      </table>,
    )

    expect(screen.queryByRole('columnheader')).not.toBeNull()
  })
})

describe('DateRangeFilterButton placement', () => {
  /** The button doubles as the readout, so the applied range is visible without opening anything. */
  it('shows the applied range on the button itself', () => {
    render(<DateRangeFilterButton value={{ preset: 'week' }} onChange={vi.fn()} />)

    expect(screen.queryByText('Last 7 Days')).not.toBeNull()
  })

  /**
   * The visible text changes with the filter; the accessible name keeps the label in front of it, so
   * the control stays identifiable to a screen reader — and to a test — in either state.
   */
  it('keeps its label in the accessible name whatever is applied', () => {
    const { rerender } = render(<DateRangeFilterButton value={EMPTY_DATE_RANGE} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Date Range' })).not.toBeNull()

    rerender(<DateRangeFilterButton value={{ preset: 'week' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Date Range: Last 7 Days' })).not.toBeNull()
  })
})
