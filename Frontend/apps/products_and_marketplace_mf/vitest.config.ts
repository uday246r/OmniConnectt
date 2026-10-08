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
    // Pinned so Date does not follow the machine's zone and CI cannot disagree with a laptop — the
    // reasoning, and the bug that prompted it, are in packages/ui/vitest.config.ts.
    env: { TZ: 'Asia/Kuala_Lumpur' },
  },
})
