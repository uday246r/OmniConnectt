import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * How a promoted release reaches a tab that is already open.
 *
 * A release moves an app's manifest URL to a new version folder. The loader used to remember only
 * WHICH apps it had registered, so a new URL was silently ignored until the page was reloaded — and
 * re-registering an app whose code is already running would put two builds of it in one page. These
 * pin the three cases: same URL (nothing to do), new URL before anything loaded (register the new
 * one), new URL after the old build loaded (refuse, so the page offers a reload).
 */

const runtime = vi.hoisted(() => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(async () => ({ default: () => null })),
}))

vi.mock('@module-federation/runtime', () => runtime)

const { loadRemoteAppModule, needsReloadForNewVersion, resetRemoteLoaderForTests } = await import('./remoteLoader')

const V1 = { key: 'lead', manifestUrl: '/modules/lead/1.0.0/mf-manifest.json' }
const V2 = { key: 'lead', manifestUrl: '/modules/lead/1.0.1/mf-manifest.json' }

/** The rejection itself, so the assertion reads the real error rather than a matcher's view of it. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the promise to reject')
}

beforeEach(() => {
  resetRemoteLoaderForTests()
  runtime.registerRemotes.mockClear()
  runtime.loadRemote.mockReset()
  runtime.loadRemote.mockImplementation(async () => ({ default: () => null }))
})

describe('remoteLoader', () => {
  it('registers an app once for as long as its URL stays the same', async () => {
    await loadRemoteAppModule(V1)
    await loadRemoteAppModule(V1)

    expect(runtime.registerRemotes).toHaveBeenCalledTimes(1)
    expect(runtime.registerRemotes).toHaveBeenCalledWith([{ name: 'lead', entry: V1.manifestUrl }], undefined)
  })

  it('replaces the registration when a new build is promoted before the old one ever loaded', async () => {
    runtime.loadRemote.mockRejectedValueOnce(new Error('offline'))
    expect((await rejectionOf(loadRemoteAppModule(V1))).message).toBe('offline')

    await loadRemoteAppModule(V2)

    expect(runtime.registerRemotes).toHaveBeenLastCalledWith([{ name: 'lead', entry: V2.manifestUrl }], { force: true })
  })

  it('refuses to load a new build beside one this page already runs, so the page can offer a reload', async () => {
    await loadRemoteAppModule(V1)

    expect(needsReloadForNewVersion(V2)).toBe(true)
    expect(needsReloadForNewVersion(V1)).toBe(false)
    expect((await rejectionOf(loadRemoteAppModule(V2))).message).toMatch(/reload/i)
    expect(runtime.registerRemotes).toHaveBeenCalledTimes(1)
  })
})
