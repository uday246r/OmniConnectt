import 'vitest'

/**
 * The jest-dom matchers used by this package's own tests.
 *
 * Declared rather than pulled in wholesale from @testing-library/jest-dom, matching what each app
 * already does (apps/*\/src/test/jest-dom.d.ts): a new assertion is then a deliberate one-line
 * addition here instead of a type surface nobody chose.
 */
declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    toBeInTheDocument(): R
    toBeDisabled(): R
    toBeEnabled(): R
    toBeRequired(): R
    toHaveAttribute(name: string, value?: unknown): R
    toHaveTextContent(text: string | RegExp): R
    toHaveFocus(): R
  }
}
