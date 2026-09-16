import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

/**
 * A fresh QueryClient per test: no retries (a rejected mock should fail the query at once), no garbage
 * collection timer left running, and — the reason it must be per test — no cached rows carried from
 * one test into the next.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // staleTime mirrors the app's client (shared/query/queryClient.ts), so cache behaviour under test is the real one.
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

/** Renders inside a QueryClientProvider and a MemoryRouter. Returns the client so a test can inspect or invalidate the cache. */
export function renderWithQuery(
  ui: ReactElement,
  { client = createTestQueryClient(), route = '/', ...options }: RenderOptions & { client?: QueryClient; route?: string } = {},
) {
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
    options,
  )
  return { ...result, client }
}
