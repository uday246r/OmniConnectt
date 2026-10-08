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
    // `pnpm -r test` runs every package at once; suites that re-import a module graph per test
    // (vi.resetModules) crossed the 5s default under that load and failed by timeout alone. Sized for
    // a loaded CI runner — see customer360_mf/vitest.config.ts.
    testTimeout: 20_000,
    /*
     * The clock these tests run on, pinned.
     *
     * Without this, Date follows whatever zone the machine is in, so a suite can pass on a
     * developer's laptop and fail on CI. That is not hypothetical: dateRange.test.ts guards against a
     * custom range being read as UTC instead of local, and in UTC — which is what a GitHub runner
     * uses — those two readings produce the same string, so the guard was asserting that a value did
     * not equal itself. It passed at UTC+5:30 and failed on CI.
     *
     * Pinning means local and UTC are genuinely different wherever the suite runs, so that class of
     * bug is caught instead of hidden, and a CI failure reproduces locally. Asia/Kuala_Lumpur is the
     * platform's own zone and has no daylight saving, so day boundaries do not move with the season.
     */
    env: { TZ: 'Asia/Kuala_Lumpur' },
  },
})
