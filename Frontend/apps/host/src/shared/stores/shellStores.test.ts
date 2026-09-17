import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Shell stores that must not publish changes nobody can see.
 *
 * Each of these used to write a new value on a timer or on navigation even when nothing had changed,
 * and every subscriber re-rendered for it: the health poll stored a new array each minute; the sidebar
 * wrote a new expanded-set on every page change; and a background navigation refetch flipped the status
 * back to "loading", which made the remote-app page replace the mounted app with a skeleton —
 * unmounting it and losing whatever the user had open.
 */

const api = vi.hoisted(() => ({
  navigation: vi.fn(),
  health: vi.fn(),
}))

vi.mock('../api/navigationApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/navigationApi')>()),
  navigationApi: { get: api.navigation },
}))

vi.mock('../../features/settings-applications/api/remoteAppsApi', () => ({
  remoteAppsApi: { health: api.health, refreshHealth: api.health },
}))

const { useNavigationStore } = await import('./navigationStore')
const { useRemoteHealthStore } = await import('./remoteHealthStore')

const tree = { sections: [{ key: 'apps', label: 'Apps', sortOrder: 1, pinToBottom: false, items: [] }] }

beforeEach(() => {
  vi.clearAllMocks()
  useNavigationStore.setState({ status: 'idle', sections: [], error: null, expanded: new Set() })
  useRemoteHealthStore.setState({ status: 'idle', entries: [] })
})

describe('navigation store', () => {
  it('shows loading on the first load only, never while refreshing a tree already on screen', async () => {
    api.navigation.mockResolvedValue(tree)
    await useNavigationStore.getState().fetch('t')
    const statuses: string[] = []
    const unsubscribe = useNavigationStore.subscribe((s) => statuses.push(s.status))

    await useNavigationStore.getState().fetch('t')
    unsubscribe()

    expect(statuses).not.toContain('loading')
    expect(useNavigationStore.getState().status).toBe('loaded')
  })

  it('does not publish a change when a sidebar row is already in the requested state', () => {
    useNavigationStore.getState().setExpanded('remote.lead', true)
    const before = useNavigationStore.getState().expanded
    const listener = vi.fn()
    const unsubscribe = useNavigationStore.subscribe(listener)

    useNavigationStore.getState().setExpanded('remote.lead', true)
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
    expect(useNavigationStore.getState().expanded).toBe(before)
  })
})

describe('remote health store', () => {
  const entries = [{ key: 'lead', displayName: 'Lead', health: 'Healthy', lastCheckedAt: '2026-09-17T08:00:00Z', error: null }]

  it('keeps the same entries when a poll finds nothing new, so subscribers are not re-rendered', async () => {
    api.health.mockImplementation(() => Promise.resolve(entries.map((e) => ({ ...e }))))
    await useRemoteHealthStore.getState().fetch('t')
    const listener = vi.fn()
    const unsubscribe = useRemoteHealthStore.subscribe(listener)

    await useRemoteHealthStore.getState().fetch('t')
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
  })

  it('publishes when a health value really changes', async () => {
    api.health.mockResolvedValueOnce(entries).mockResolvedValueOnce([{ ...entries[0], health: 'Unreachable' }])
    await useRemoteHealthStore.getState().fetch('t')

    await useRemoteHealthStore.getState().fetch('t')

    expect(useRemoteHealthStore.getState().entries[0].health).toBe('Unreachable')
  })
})
