import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkeletonChart, SkeletonDetail, SkeletonForm, SkeletonList } from './SkeletonComposites'
import { StatTileSkeleton } from '../../data/StatTile/StatTile'

/**
 * The placeholders shaped like what they stand in for.
 *
 * What these can usefully hold is not the look — that is checked by eye — but the two things a
 * placeholder gets wrong silently. One is its size: a skeleton exists to occupy the room the content
 * will, so the number of sections and fields it draws has to be the number it was asked for, or the
 * page jumps when the data lands. The other is what it says to someone who cannot see it: a loading
 * region announces itself once, as a status, and a purely decorative placeholder stays out of the
 * accessibility tree altogether rather than reading out as a pile of empty groups.
 */
describe('composite skeletons', () => {
  it('draws the form it was asked for: a card per section, a label and a control per field', () => {
    const { container } = render(<SkeletonForm sections={3} fieldsPerSection={4} />)

    const region = screen.getByRole('status', { name: 'Loading form' })
    // Each section: one title placeholder, then two placeholders (label, control) per field.
    expect(region.children).toHaveLength(3)
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3 * (1 + 4 * 2))
  })

  it('draws the detail drawer it was asked for', () => {
    render(<SkeletonDetail sections={2} fieldsPerSection={6} />)

    expect(screen.getByRole('status', { name: 'Loading details' }).children).toHaveLength(2)
  })

  it('announces a chart as loading whichever silhouette it draws', () => {
    const { rerender } = render(<SkeletonChart variant="bars" />)
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument()

    rerender(<SkeletonChart variant="donut" />)
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument()

    rerender(<SkeletonChart variant="line" />)
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument()
  })

  it('draws one row per item in a feed', () => {
    render(<SkeletonList rows={4} />)

    expect(screen.getByRole('status', { name: 'Loading' }).children).toHaveLength(4)
  })

  it('keeps a stat tile placeholder out of the accessibility tree', () => {
    // It sits in a row beside real tiles that each name themselves; a placeholder that also
    // announced itself would read as a tile with no figure.
    const { container } = render(<StatTileSkeleton foot />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
