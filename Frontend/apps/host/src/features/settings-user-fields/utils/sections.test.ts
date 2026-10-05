import { describe, it, expect } from 'vitest'
import type { FieldDefinition } from '@omniconnect/ui/validation'
import type { FieldSection } from '../api/fieldSectionsApi'
import { arrangeFields, groupFieldsBySection, legacyDefaultSectionKey, resolveSectionKey, sectionLabel } from './sections'

/**
 * The client half of the section rules: it must agree with FieldSectionAppService.ResolveSectionKey and
 * UserFieldSchemaAppService.Arrange, because the editor previews the layout the server is about to
 * store. A disagreement would show an admin one arrangement and save another.
 */

const sections: FieldSection[] = [
  { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
  { key: 'address', label: 'Address', order: 2, isSystem: false },
  { key: 'employment', label: 'Employment', order: 3, isSystem: false },
]

const field = (key: string, order: number, section?: string): FieldDefinition => ({
  key,
  label: key,
  core: false,
  dataType: 'text',
  required: false,
  order,
  validations: [],
  section,
})

describe('resolveSectionKey', () => {
  it.each([
    ['address', 'address'],
    ['ADDRESS', 'address'],
    ['  Address  ', 'address'],
    ['personal details', 'personal-details'],
  ])('resolves %s to the key %s, accepting a key or a legacy label in any case', (stored, expected) => {
    expect(resolveSectionKey(stored, sections)).toBe(expected)
  })

  it.each([[undefined], [null], [''], ['   '], ['Deleted Section']])(
    'falls back to the system section for %s rather than throwing',
    (stored) => {
      expect(resolveSectionKey(stored, sections)).toBe('personal-details')
    },
  )
})

describe('arrangeFields', () => {
  it('orders sections by the catalog and renumbers order per section', () => {
    const result = arrangeFields(
      [field('street', 7, 'address'), field('name', 1, 'personal-details'), field('city', 9, 'address'), field('nick', 5, 'personal-details')],
      sections,
    )

    expect(result.map((f) => f.key)).toEqual(['name', 'nick', 'street', 'city'])
    expect(result.filter((f) => f.section === 'personal-details').map((f) => f.order)).toEqual([1, 2])
    expect(result.filter((f) => f.section === 'address').map((f) => f.order)).toEqual([1, 2])
  })

  it('upgrades a legacy label to the section key', () => {
    expect(arrangeFields([field('street', 1, 'Address')], sections)[0].section).toBe('address')
  })

  it('keeps ties in their original relative order', () => {
    const result = arrangeFields([field('a', 1, 'address'), field('b', 1, 'address')], sections)
    expect(result.map((f) => f.key)).toEqual(['a', 'b'])
  })

  it('lets a moved field go last in its new section by giving it a large order', () => {
    const result = arrangeFields(
      [field('a', 1, 'address'), field('b', 2, 'address'), field('moved', 10_000, 'address')],
      sections,
    )
    expect(result.map((f) => f.key)).toEqual(['a', 'b', 'moved'])
    expect(result[2].order).toBe(3)
  })
})

describe('groupFieldsBySection', () => {
  const fields = [field('name', 1, 'personal-details'), field('street', 1, 'address')]

  it('includes empty sections by default so an admin can add the first field to one', () => {
    const groups = groupFieldsBySection(fields, sections)
    expect(groups.map((g) => g.section.key)).toEqual(['personal-details', 'address', 'employment'])
    expect(groups[2].fields).toEqual([])
  })

  it('omits empty sections for forms', () => {
    expect(groupFieldsBySection(fields, sections, { skipEmpty: true }).map((g) => g.section.key)).toEqual([
      'personal-details',
      'address',
    ])
  })
})

describe('sectionLabel', () => {
  it('shows the catalog label for a key so a rename is reflected everywhere', () => {
    const renamed = sections.map((s) => (s.key === 'address' ? { ...s, label: 'Contact & Address' } : s))
    expect(sectionLabel('address', renamed)).toBe('Contact & Address')
  })
})

describe('legacy default section for a field with no stored section', () => {
  it('puts address-shaped fields under Address, as the old form did', () => {
    const result = arrangeFields(
      [
        { ...field('country', 1), template: 'contact-country' },
        field('postalCode', 2),
        field('nickname', 3),
      ],
      sections,
    )

    expect(result.find((f) => f.key === 'country')?.section).toBe('address')
    expect(result.find((f) => f.key === 'postalCode')?.section).toBe('address')
    expect(result.find((f) => f.key === 'nickname')?.section).toBe('personal-details')
  })

  it('never overrides a section the admin explicitly chose', () => {
    expect(arrangeFields([field('country', 1, 'employment')], sections)[0].section).toBe('employment')
  })

  it('matches keys exactly, so "estate" is not mistaken for "state"', () => {
    expect(legacyDefaultSectionKey({ key: 'estate' }, sections)).toBeUndefined()
    expect(legacyDefaultSectionKey({ key: 'city' }, sections)).toBe('address')
  })

  it('does nothing once the Address section has been deleted', () => {
    const withoutAddress = sections.filter((s) => s.key !== 'address')
    expect(arrangeFields([field('city', 1)], withoutAddress)[0].section).toBe('personal-details')
  })
})
