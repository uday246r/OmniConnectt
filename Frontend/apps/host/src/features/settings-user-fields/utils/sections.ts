import type { FieldDefinition } from '@omniconnect/ui/validation'
import type { FieldSection } from '../api/fieldSectionsApi'

/**
 * How a field's stored `section` maps to a real section, and how a flat field list is laid out into
 * sections. This is the client twin of `FieldSectionAppService.ResolveSectionKey` and
 * `UserFieldSchemaAppService.Arrange` — the server is the authority, this exists so the editor can show
 * the same layout the server will store before the admin saves.
 *
 * Forgiving on purpose: sections used to be free text, so a stored value may be a label ("Address"), a
 * key, blank, or the name of a section that has since been deleted. None of those may make the form
 * unrenderable, so anything unresolvable lands in the system section.
 */

/** The undeletable section; the seeded name/email/phone fields live here. */
export const SYSTEM_SECTION_KEY = 'personal-details'

/** Stand-in used until the catalog loads, and if it fails to — a form must never render sectionless. */
export const FALLBACK_SECTIONS: FieldSection[] = [
  { key: SYSTEM_SECTION_KEY, label: 'Personal Details', order: 1, isSystem: true },
]

/** Template ids and exact keys that meant "Address" before sections were configurable. */
const LEGACY_ADDRESS_TEMPLATES = new Set(['contact-country', 'contact-state', 'contact-city', 'contact-postal-code', 'contact-street-address'])
const LEGACY_ADDRESS_KEYS = new Set(['country', 'stateprovince', 'city', 'postalcode', 'address'])

/**
 * The section a field used to land in when it had none stored: address-shaped fields went under
 * "Address", everything else under the default section. Applied ONLY when `section` is blank — an
 * explicit choice always wins — and only when an `address` section still exists, so an admin who deleted
 * it does not have fields pushed back into a section they removed. Deliberately exact-match, not the
 * old substring guesses: "estate" must not count as "state".
 */
export function legacyDefaultSectionKey(
  field: Pick<FieldDefinition, 'key' | 'template'>,
  sections: readonly FieldSection[],
): string | undefined {
  const addressSection = sections.find((s) => s.key === 'address')
  if (!addressSection) return undefined
  if ((field.template && LEGACY_ADDRESS_TEMPLATES.has(field.template)) || LEGACY_ADDRESS_KEYS.has(field.key.toLowerCase())) {
    return addressSection.key
  }
  return undefined
}

export function resolveSectionKey(stored: string | undefined | null, sections: readonly FieldSection[]): string {
  const value = stored?.trim().toLowerCase()
  if (value) {
    const byKey = sections.find((s) => s.key.toLowerCase() === value)
    if (byKey) return byKey.key
    const byLabel = sections.find((s) => s.label.trim().toLowerCase() === value)
    if (byLabel) return byLabel.key
  }
  return sections.find((s) => s.isSystem)?.key ?? SYSTEM_SECTION_KEY
}

/**
 * Puts every field in a real section, orders sections by the catalog and fields by their existing
 * relative order within each, then renumbers `order` 1..n PER SECTION.
 */
export function arrangeFields(fields: readonly FieldDefinition[], sections: readonly FieldSection[]): FieldDefinition[] {
  const rank = new Map(sections.map((s, i) => [s.key.toLowerCase(), i]))
  const placed = fields
    .map((f, index) => ({
      field: { ...f, section: resolveSectionKey(f.section?.trim() ? f.section : legacyDefaultSectionKey(f, sections), sections) },
      index,
    }))
    .sort((a, b) => {
      const byRank =
        (rank.get(a.field.section!.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.field.section!.toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
      return byRank || a.field.order - b.field.order || a.index - b.index
    })
    .map((p) => p.field)

  const counters = new Map<string, number>()
  return placed.map((f) => {
    const k = f.section!.toLowerCase()
    const next = (counters.get(k) ?? 0) + 1
    counters.set(k, next)
    return { ...f, order: next }
  })
}

export interface SectionGroup {
  section: FieldSection
  fields: FieldDefinition[]
}

/**
 * Fields grouped by section in catalog order, each group in field order. Empty sections are included
 * (the Manage page shows them so an admin can add the first field); pass `skipEmpty` for forms.
 */
export function groupFieldsBySection(
  fields: readonly FieldDefinition[],
  sections: readonly FieldSection[],
  { skipEmpty = false }: { skipEmpty?: boolean } = {},
): SectionGroup[] {
  const arranged = arrangeFields(fields, sections)
  const groups = [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      section,
      fields: arranged.filter((f) => f.section!.toLowerCase() === section.key.toLowerCase()),
    }))
  return skipEmpty ? groups.filter((g) => g.fields.length > 0) : groups
}

/** Display name for a stored section value — the catalog label, or the raw value if it can't be resolved. */
export function sectionLabel(stored: string | undefined | null, sections: readonly FieldSection[]): string {
  const key = resolveSectionKey(stored, sections)
  return sections.find((s) => s.key === key)?.label ?? stored ?? ''
}
