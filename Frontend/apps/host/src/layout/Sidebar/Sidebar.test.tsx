import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto, NavSectionDto } from '../../shared/api/navigationApi'

/**
 * The sidebar renders whatever the server sends and nothing else.
 *
 * These tests exist because the previous arrangement had no way to be tested at all: each remote
 * located the host's anchor by query selector, appended a chevron into it and portalled a hardcoded
 * submenu beside it, retrying for four seconds. Behaviour that depends on two applications racing
 * over one DOM node cannot be asserted.
 */

function node(over: Partial<NavNodeDto> & Pick<NavNodeDto, 'key' | 'label' | 'routePath'>): NavNodeDto {
  return {
    iconKey: null,
    page: null,
    order: 0,
    kind: 'host',
    state: 'visible',
    maintenanceMessage: null,
    remote: null,
    children: [],
    ...over,
  }
}

const LEAD = node({
  key: 'remote.lead',
  label: 'Lead Management',
  routePath: '/apps/lead',
  kind: 'remote-app',
  remote: {
    appKey: 'lead',
    manifestUrl: 'http://localhost:5002/mf-manifest.json',
    containerName: 'lead_mf',
    defaultRoutePath: '/apps/lead/view-lead',
  },
  children: [
    node({ key: 'remote.lead.lead#view-lead', label: 'View Leads', routePath: '/apps/lead/view-lead', kind: 'submodule', page: 'view-lead' }),
    node({ key: 'remote.lead.lead#create-lead', label: 'Create Lead', routePath: '/apps/lead/create-lead', kind: 'submodule', page: 'create-lead' }),
  ],
})

function sections(items: NavNodeDto[] = [LEAD]): NavSectionDto[] {
  return [{ key: 'apps', label: 'Apps', order: 20, pinToBottom: false, items }]
}

function renderSidebar(tree: NavSectionDto[], route = '/') {
  useNavigationStore.setState({ status: 'loaded', sections: tree, error: null, expanded: new Set() })
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useNavigationStore.setState({ status: 'idle', sections: [], error: null, expanded: new Set() })
})

describe('rendering the server tree', () => {
  it('renders section labels from the server rather than hardcoded strings', () => {
    renderSidebar([{ key: 'apps', label: 'Applications', order: 20, pinToBottom: false, items: [LEAD] }])

    expect(screen.getByText('Applications')).toBeInTheDocument()
  })

  it('renders both rows a single feature owns', async () => {
    // View Leads and Create Lead are the same remote.lead.lead feature. This is the pair a
    // one-row-per-module design silently dropped.
    renderSidebar(sections())
    await userEvent.click(screen.getByRole('button', { name: /lead management/i }))

    expect(screen.getByRole('link', { name: /view leads/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create lead/i })).toBeInTheDocument()
  })

  it('renders nothing for a node the server omitted', () => {
    renderSidebar(sections([]))

    expect(screen.queryByText('Lead Management')).not.toBeInTheDocument()
  })
})

describe('the group header, owned by the host', () => {
  it('is a plain link, not a toggle, when a row has no children', () => {
    renderSidebar(sections([node({ key: 'host.dashboard', label: 'Dashboard', routePath: '/' })]))

    expect(screen.queryByRole('button', { name: /dashboard/i })).not.toBeInTheDocument()
  })

  it('starts collapsed, so children are not in the document', () => {
    renderSidebar(sections())

    expect(screen.queryByRole('link', { name: /view leads/i })).not.toBeInTheDocument()
  })

  it('expands and collapses, and reports its state to assistive tech', async () => {
    renderSidebar(sections())
    const chevron = screen.getByRole('button', { name: /lead management/i })

    expect(chevron).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(chevron)
    expect(screen.getByRole('button', { name: /lead management/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /view leads/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /lead management/i }))
    expect(screen.queryByRole('link', { name: /view leads/i })).not.toBeInTheDocument()
  })

  it('collapses again on a second click anywhere on the row, and never navigates', async () => {
    // The bug this replaces: the row was a link and only the small chevron toggled, so clicking the
    // app name opened the group but clicking it again navigated instead of closing — and landing
    // back on a child route re-expanded it, so the name could never close what it had opened.
    renderSidebar(sections())
    const row = screen.getByRole('button', { name: /lead management/i })

    // A button, not an anchor: there is no href to follow, so a click cannot navigate away.
    expect(row.tagName).toBe('BUTTON')
    expect(row.closest('a')).toBeNull()

    await userEvent.click(row)
    expect(screen.getByRole('link', { name: /view leads/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /lead management/i }))
    expect(screen.queryByRole('link', { name: /view leads/i })).not.toBeInTheDocument()
  })

  it('expands the group containing the current route on load', () => {
    // A refresh onto a sub-page must not show it collapsed and apparently missing.
    renderSidebar(sections(), '/apps/lead/view-lead')

    expect(screen.getByRole('link', { name: /view leads/i })).toBeInTheDocument()
  })

  it('persists which groups were open, so a reload restores them', async () => {
    const { unmount } = renderSidebar(sections())
    await userEvent.click(screen.getByRole('button', { name: /lead management/i }))
    unmount()

    // The store rehydrates from localStorage on creation, so asserting on what was written is what
    // actually proves a reload would restore it — re-rendering here would only re-read the store
    // that is already in memory.
    expect(JSON.parse(localStorage.getItem('omni.sidebar.expanded')!)).toContain('remote.lead')
  })

  it('renders expanded when the store already has the group open', () => {
    useNavigationStore.setState({
      status: 'loaded',
      sections: sections(),
      error: null,
      expanded: new Set(['remote.lead']),
    })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /view leads/i })).toBeInTheDocument()
  })
})

describe('nothing about the sidebar is decided in the browser', () => {
  it('takes its section labels from the server, whatever they are', () => {
    renderSidebar([{ key: 'anything', label: 'Some Group', order: 5, pinToBottom: false, items: [LEAD] }])

    expect(screen.getByText('Some Group')).toBeInTheDocument()
  })

  it('pins a section from a flag rather than by recognising its key', () => {
    // The browser used to test `section.key === 'system'` to apply this styling, which meant it had
    // to know one section by name. The server says so now, so a renamed or new section still pins.
    const { container } = renderSidebar([
      { key: 'renamed-entirely', label: 'Ops', order: 5, pinToBottom: true, items: [LEAD] },
    ])

    // The pinned class is applied to the section wrapper, not derived from its key.
    expect(container.querySelector('nav > div')?.className).not.toBe('')
    expect(screen.getByText('Ops')).toBeInTheDocument()
  })
})

describe('maintenance state', () => {
  it('marks a row under maintenance with its message', () => {
    renderSidebar(sections([{ ...LEAD, state: 'maintenance', maintenanceMessage: 'Back at 09:00.' }]))

    // A row with children is a group-header button, not a link.
    expect(screen.getByRole('button', { name: /lead management/i })).toHaveAttribute('title', 'Back at 09:00.')
  })

  it('badges an unreachable app from the health overlay, not the tree', () => {
    useNavigationStore.setState({ status: 'loaded', sections: sections(), error: null, expanded: new Set() })
    render(
      <MemoryRouter>
        <Sidebar health={{ lead: 'Unreachable' }} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('button', { name: /lead management/i })
    expect(within(row).getByTitle('App server not responding')).toBeInTheDocument()
  })
})

describe('failure states', () => {
  it('shows the error rather than an empty sidebar', () => {
    useNavigationStore.setState({ status: 'error', sections: [], error: 'Could not load navigation.', expanded: new Set() })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Could not load navigation.')
  })
})

describe('active state', () => {
  it('marks only the child as the current page, not its parent too', () => {
    // A NavLink to /apps/lead matches /apps/lead/view-lead by prefix, so without `end` both rows
    // claimed aria-current="page" — found while verifying against the real app. Only one row can be
    // the current page, and announcing two leaves a screen-reader user unable to tell which.
    renderSidebar(sections(), '/apps/lead/view-lead')

    const current = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.getAttribute('href'))

    expect(current).toEqual(['/apps/lead/view-lead'])
  })
})
