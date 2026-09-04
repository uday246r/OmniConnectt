import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityPicker } from './CapabilityPicker'
import type { PermissionRow } from './catalog'
import type { CapabilityDto } from '../api/permissionsApi'

/**
 * The picker is the only place a business capability can be granted from.
 *
 * The matrix beside it deliberately shows verbs only, so anything this component fails to render is
 * a permission that exists in the database, is enforced by the services, and cannot be given to
 * anyone through the product.
 */

function cap(over: Partial<CapabilityDto> & Pick<CapabilityDto, 'key'>): CapabilityDto {
  return { displayName: over.key, type: 'Widget', groupKey: null, description: null, ...over }
}

const DASHBOARD: PermissionRow = {
  key: 'remote.lead.dashboard',
  label: 'Dashboard',
  isParent: false,
  capabilities: [
    cap({ key: 'View', type: 'Api' }),
    cap({ key: 'kpi.total-leads', displayName: 'KPI: Total Leads', groupKey: 'kpi', description: 'Show the Total Leads card.' }),
    cap({ key: 'kpi.converted', displayName: 'KPI: Converted', groupKey: 'kpi' }),
    cap({ key: 'chart.leads-over-time', displayName: 'Chart: Leads Over Time', type: 'Chart', groupKey: 'chart' }),
  ],
}

function renderPicker(
  rows: PermissionRow[] = [DASHBOARD],
  granted: string[] = [],
  props: Partial<Parameters<typeof CapabilityPicker>[0]> = {},
) {
  const onToggle = vi.fn()
  const held = new Set(granted)
  render(
    <CapabilityPicker
      rows={rows}
      isGranted={(f, c) => held.has(`${f}:${c}`)}
      onToggle={onToggle}
      {...props}
    />,
  )
  return { onToggle }
}

describe('what it shows', () => {
  it('offers every business capability the row declares', () => {
    renderPicker()

    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /converted/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /leads over time/i })).toBeInTheDocument()
  })

  it('leaves the CRUD verb to the matrix rather than listing it twice', () => {
    renderPicker()

    expect(screen.queryByRole('checkbox', { name: /^view$/i })).not.toBeInTheDocument()
  })

  it('groups by the dotted prefix, so KPIs and charts are separate sections', () => {
    renderPicker()

    expect(screen.getByRole('button', { name: /dashboard · kpi/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dashboard · chart/i })).toBeInTheDocument()
  })

  it('shows the description, since a key alone rarely explains a business capability', () => {
    renderPicker()

    expect(screen.getByText('Show the Total Leads card.')).toBeInTheDocument()
  })

  it('labels the type, which is the only clue whether granting refuses a request or hides a control', () => {
    renderPicker()

    expect(screen.getAllByText('Widget').length).toBeGreaterThan(0)
    expect(screen.getByText('Chart')).toBeInTheDocument()
  })

  it('says so plainly when a feature declares none', () => {
    const rows = [{ key: 'host.dashboard', label: 'Dashboard', isParent: true, capabilities: [cap({ key: 'View', type: 'Api' })] }]

    renderPicker(rows)
    expect(screen.getByText(/no application declares capabilities of this kind/i)).toBeInTheDocument()
  })

  it('lets the caller word the empty state for its own context', () => {
    // The host step and an app accordion mean different things by "nothing here", and a generic
    // sentence in the app accordion reads as though the app failed to load.
    renderPicker(
      [{ key: 'host.dashboard', label: 'Dashboard', isParent: true, capabilities: [] }],
      [],
      { emptyMessage: 'This application declares no dashboard, export or panel capabilities.' },
    )

    expect(screen.getByText(/this application declares no dashboard/i)).toBeInTheDocument()
  })
})

describe('granting', () => {
  it('reflects what is already granted', () => {
    renderPicker([DASHBOARD], ['remote.lead.dashboard:kpi.total-leads'])

    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /converted/i })).not.toBeChecked()
  })

  it('emits the feature key and capability key, not a display label', async () => {
    const { onToggle } = renderPicker()

    await userEvent.click(screen.getByRole('checkbox', { name: /total leads/i }))

    expect(onToggle).toHaveBeenCalledWith('remote.lead.dashboard', 'kpi.total-leads')
  })

  it('grants a whole group at once, and only the ones not already granted', async () => {
    const { onToggle } = renderPicker([DASHBOARD], ['remote.lead.dashboard:kpi.total-leads'])

    const kpiGroup = screen.getByRole('button', { name: /dashboard · kpi/i }).parentElement!
    await userEvent.click(within(kpiGroup).getByRole('button', { name: 'All' }))

    // Only the ungranted one is toggled: sending the granted one too would turn it off.
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('remote.lead.dashboard', 'kpi.converted')
  })

  it('clears a fully-granted group', async () => {
    const { onToggle } = renderPicker([DASHBOARD], [
      'remote.lead.dashboard:kpi.total-leads',
      'remote.lead.dashboard:kpi.converted',
    ])

    const kpiGroup = screen.getByRole('button', { name: /dashboard · kpi/i }).parentElement!
    await userEvent.click(within(kpiGroup).getByRole('button', { name: 'Clear' }))

    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('is read-only for an administrator, who holds everything by definition', async () => {
    const { onToggle } = renderPicker([DASHBOARD], [], { disabled: true })

    const box = screen.getByRole('checkbox', { name: /total leads/i })
    expect(box).toBeChecked()
    expect(box).toBeDisabled()

    await userEvent.click(box)
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('search', () => {
  it('matches the description, not only the label', async () => {
    // Someone looking for "who can see the Total Leads card" types words from the sentence, not the
    // key. Searching keys alone would find nothing and read as a broken filter.
    renderPicker()

    await userEvent.type(screen.getByRole('searchbox', { name: /search capabilities/i }), 'card')

    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /leads over time/i })).not.toBeInTheDocument()
  })

  it('hides a group whose entries all filtered out, rather than an empty header', async () => {
    renderPicker()

    await userEvent.type(screen.getByRole('searchbox', { name: /search capabilities/i }), 'over time')

    expect(screen.queryByRole('button', { name: /dashboard · kpi/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dashboard · chart/i })).toBeInTheDocument()
  })

  it('says nothing matched instead of showing a blank panel', async () => {
    renderPicker()

    await userEvent.type(screen.getByRole('searchbox', { name: /search capabilities/i }), 'zzzz')

    expect(screen.getByText(/no capability matches/i)).toBeInTheDocument()
  })
})

describe('collapsing', () => {
  it('starts expanded for a small catalog, because seeing everything is faster', () => {
    renderPicker()

    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeInTheDocument()
  })

  it('collapses a group on click and restores it on a second', async () => {
    renderPicker()

    await userEvent.click(screen.getByRole('button', { name: /dashboard · kpi/i }))
    expect(screen.queryByRole('checkbox', { name: /total leads/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /dashboard · kpi/i }))
    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeInTheDocument()
  })

  it('reopens a collapsed group while searching, so a match is never hidden behind it', async () => {
    renderPicker()

    await userEvent.click(screen.getByRole('button', { name: /dashboard · kpi/i }))
    await userEvent.type(screen.getByRole('searchbox', { name: /search capabilities/i }), 'total')

    expect(screen.getByRole('checkbox', { name: /total leads/i })).toBeInTheDocument()
  })
})

describe('at scale', () => {
  /** One feature declaring 2000 capabilities — far past anything real, which is the point. */
  const huge: PermissionRow = {
    key: 'remote.big.module',
    label: 'Big Module',
    isParent: false,
    capabilities: Array.from({ length: 2000 }, (_, i) =>
      cap({ key: `kpi.metric-${i}`, displayName: `KPI: Metric ${i}`, groupKey: 'kpi' }),
    ),
  }

  it('renders a bounded number of rows rather than all two thousand', () => {
    renderPicker([huge])

    // Collapsed by default at this size, so the DOM is the header alone.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /big module · kpi/i })).toBeInTheDocument()
  })

  it('still caps the rows after the group is opened', async () => {
    renderPicker([huge])

    await userEvent.click(screen.getByRole('button', { name: /big module · kpi/i }))

    const rendered = screen.getAllByRole('checkbox').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThanOrEqual(50)
    expect(screen.getByRole('button', { name: /show all 2000/i })).toBeInTheDocument()
  })

  it('finds one capability among two thousand by search', async () => {
    renderPicker([huge])

    await userEvent.type(screen.getByRole('searchbox', { name: /search capabilities/i }), 'Metric 1337')

    expect(screen.getByRole('checkbox', { name: /metric 1337/i })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })
})
