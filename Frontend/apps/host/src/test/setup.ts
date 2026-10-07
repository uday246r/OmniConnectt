import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * `waitFor` and the `findBy*` queries give up after 1s by default, whatever vitest's own timeout is.
 * vitest.config.ts already sizes `testTimeout` for a loaded machine (every package's suite running at
 * once), but that budget never reached these: a page that needed 1.2s to settle under load failed its
 * first `waitFor` with 19 seconds of test time still unspent. It showed up as one Checker Assignment
 * test failing now and then in a full run and never on its own. A passing assertion returns as soon
 * as it passes, so the longer limit costs nothing when the machine is quiet.
 */
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
})
