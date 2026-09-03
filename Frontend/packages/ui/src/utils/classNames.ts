export type ClassValue = string | false | null | undefined

/** Tiny conditional-classname joiner — kept in-house rather than adding a dependency for this alone. */
export function classNames(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
