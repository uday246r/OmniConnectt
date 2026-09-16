import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Combobox, type ComboboxOption } from './Combobox'

/**
 * The platform dropdown.
 *
 * People pick branches, products, countries and formats from long lists. A native select can only
 * jump by first letter, and the platform's own dropdowns disagreed about whether they could be
 * searched at all. These pin what every dropdown now does: type any part of a name to find it, work
 * entirely from the keyboard, announce itself correctly to assistive technology, and never commit a
 * choice the person did not make. Plain vitest assertions, as elsewhere in this package (see DateRangeControls.test.tsx).
 */

const branches: ComboboxOption[] = [
  { value: 'kl', label: 'Kuala Lumpur Main', description: 'Wilayah Persekutuan' },
  { value: 'pg', label: 'Penang', description: 'George Town' },
  { value: 'jb', label: 'Johor Bahru', disabled: true },
  { value: 'sp', label: 'São Paulo Office', group: 'Overseas' },
]

function Harness({ onChange = () => undefined, ...props }: Partial<React.ComponentProps<typeof Combobox>>) {
  const [value, setValue] = useState(props.value ?? '')
  return (
    <Combobox
      aria-label="Branch"
      options={branches}
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

const input = () => screen.getByRole('combobox', { name: 'Branch' })
const visibleOptions = () => screen.queryAllByRole('option').map((o) => o.textContent)

describe('Combobox', () => {
  it('finds an option by any part of its name or description', () => {
    render(<Harness />)

    fireEvent.change(input(), { target: { value: 'george' } })

    expect(visibleOptions()).toEqual(['PenangGeorge Town'])
  })

  it('ignores accents when searching', () => {
    render(<Harness />)

    fireEvent.change(input(), { target: { value: 'sao' } })

    expect(visibleOptions()).toEqual(['São Paulo Office'])
  })

  it('is operable from the keyboard, skipping disabled options', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('sp')
    expect((input() as HTMLInputElement).value).toBe('São Paulo Office')
  })

  it('announces the expanded state and the highlighted option', () => {
    render(<Harness />)

    expect(input().getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })

    expect(input().getAttribute('aria-expanded')).toBe('true')
    const active = input().getAttribute('aria-activedescendant')
    expect(document.getElementById(active!)?.textContent).toContain('Kuala Lumpur Main')
  })

  it('selects with a click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    fireEvent.mouseDown(input())
    fireEvent.click(screen.getByRole('option', { name: /Penang/ }))

    expect(onChange).toHaveBeenCalledWith('pg')
  })

  it('does not change anything when closed with Escape', () => {
    const onChange = vi.fn()
    render(<Harness value="kl" onChange={onChange} />)

    fireEvent.change(input(), { target: { value: 'pen' } })
    fireEvent.keyDown(input(), { key: 'Escape' })

    expect(onChange).not.toHaveBeenCalled()
    expect((input() as HTMLInputElement).value).toBe('Kuala Lumpur Main')
  })

  it('offers a clearing row when asked to', () => {
    const onChange = vi.fn()
    render(<Harness value="kl" clearLabel="All branches" onChange={onChange} />)

    fireEvent.mouseDown(input())
    fireEvent.click(screen.getByRole('option', { name: 'All branches' }))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('says so when nothing matches', () => {
    render(<Harness emptyMessage="No branch by that name" />)

    fireEvent.change(input(), { target: { value: 'zzz' } })

    expect(screen.getByText('No branch by that name')).toBeTruthy()
  })

  it('leaves filtering to the server when options are searched remotely', () => {
    const onSearch = vi.fn()
    render(<Harness onSearch={onSearch} />)

    fireEvent.change(input(), { target: { value: 'zzz' } })

    expect(onSearch).toHaveBeenCalledWith('zzz')
    expect(visibleOptions()).toHaveLength(branches.length)
  })
})
