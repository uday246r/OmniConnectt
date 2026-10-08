import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Test config kept separate from vite.config.ts on purpose: that file wires up Module Federation,
 * which needs a real dev server and a live remote to resolve anything. Tests must not depend on a
 * remote being up — the point of several of them is asserting a remote is NEVER fetched.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Several suites re-import the API module graph per test (vi.resetModules) to get a fresh request
    // cache. That takes well under a second alone, but `pnpm -r test` runs every package at once and the
    // first import then crossed the 5s default — a timeout that also leaked its pending requests into the
    // next test's call count. A budget sized for a loaded CI runner, not a correctness change.
    testTimeout: 20_000,
    // Pinned so Date does not follow the machine's zone and CI cannot disagree with a laptop — the
    // reasoning, and the bug that prompted it, are in packages/ui/vitest.config.ts.
    env: { TZ: 'Asia/Kuala_Lumpur' },
  },
})
