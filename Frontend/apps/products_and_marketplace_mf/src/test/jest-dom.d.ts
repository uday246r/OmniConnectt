import 'vitest'

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    toBeInTheDocument(): R
    toBeDisabled(): R
    toHaveAttribute(name: string, value?: unknown): R
    toHaveTextContent(text: string | RegExp): R
  }
}
