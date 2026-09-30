/**
 * The checks a catalogue form makes before it asks the server.
 *
 * They restate the server's own rules (`CategoryCreateUpdateDto` and friends) so a mistake is caught on
 * the field, not after a round trip. The server still decides — a request that skips the form is held to
 * the same rules — so these can only ever be as strict as it is, never stricter.
 */

/** A code: letters, numbers, hyphens and underscores, starting with a letter or number. */
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const CODE_HINT = 'Letters, numbers, hyphens and underscores only, starting with a letter or number.';

export const NAME_MAX = 150;
export const CODE_MAX = 30;

export function validateName(name: string, what: string, max = NAME_MAX): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return `${what} name is required.`;
  if (trimmed.length < 2 || trimmed.length > max) return `${what} name must be between 2 and ${max} characters.`;
  return undefined;
}

export function validateCode(code: string, what: string, max = CODE_MAX): string | undefined {
  const trimmed = code.trim();
  if (trimmed.length === 0) return `${what} code is required.`;
  if (trimmed.length < 2 || trimmed.length > max) return `${what} code must be between 2 and ${max} characters.`;
  if (!CODE_PATTERN.test(trimmed)) return CODE_HINT;
  return undefined;
}

export function validateDescription(description: string, max = 1000): string | undefined {
  return description.length > max ? `Description cannot exceed ${max} characters.` : undefined;
}

/** The first of these errors that is set, for a form that shows one summary; undefined when there are none. */
export const hasErrors = (errors: Record<string, string | undefined>): boolean => Object.values(errors).some(Boolean);
