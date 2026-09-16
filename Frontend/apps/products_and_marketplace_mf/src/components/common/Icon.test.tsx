import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, type IconName } from './Icon'

/**
 * Icon names come from code and from data (a category's or product's icon key). Several call sites used
 * names that did not exist and silently showed the package glyph instead. This checks those names now
 * draw their own glyph, and that an unknown key from data still renders something rather than nothing.
 */
function pathsOf(name: string) {
  const { container } = render(<Icon name={name as IconName} />)
  return container.querySelector('svg')?.innerHTML ?? ''
}

describe('Icon', () => {
  it.each(['file-text', 'check-circle', 'message-square', 'refresh-cw'])('draws "%s" as its own glyph, not the fallback', (name) => {
    expect(pathsOf(name)).not.toBe(pathsOf('package'))
  })

  it('draws product-domain pictograms from the local set', () => {
    expect(pathsOf('percent')).toContain('circle')
  })

  it('falls back to the package glyph for a key it does not know', () => {
    expect(pathsOf('no-such-icon')).toBe(pathsOf('package'))
  })

  it('honours the requested size', () => {
    const { container } = render(<Icon name="search" size={24} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '24')
  })
})
