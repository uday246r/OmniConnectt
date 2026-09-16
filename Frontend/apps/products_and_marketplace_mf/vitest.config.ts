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
  },
})
