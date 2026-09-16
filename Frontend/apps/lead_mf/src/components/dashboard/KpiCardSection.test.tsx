import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { KpiCardSection } from './KpiCardSection'
import { useLeadStore } from '../../store/useLeadStore'
import type { OmniConnectHostBridge } from '../../api/hostBridge'

/**
 * Which KPI cards the dashboard puts on screen.
 *
 * The front-end half of a pair: the server redacts the numbers a caller was not granted, and this
 * removes the cards that would otherwise render empty. Neither alone is sufficient — the server side
 * is the control, and this is what stops the page looking broken while it does its job.
 *
 * Cards are removed rather than blanked deliberately. A card headed "Total Leads" showing a dash
 * reads as a loading failure and gets reported as a bug; a grid with fewer cards reads as a
 * configuration.
 */

function bridgeGranting(...granted: string[]) {
  window.__omniconnectHost__ = {
    getAccessToken: () => 'token',
    ensureFreshAccessToken: () => Promise.resolve('token'),
    hasCapability: (featureKey: string, capability: string) =>
      granted.includes(`${featureKey}:${capability}`),
    getUser: () => ({
      id: 'u1',
      name: 'Tester',
      email: 'tester@example.com',
      isAdministrator: false,
      roleName: null,
      permissions: [],
    }),
  } as OmniConnectHostBridge
}

/** Grants the dashboard cards by their capability key, which is what the manifest names them. */
function grantCards(...cards: string[]) {
  bridgeGranting(...cards.map((c) => `remote.lead.dashboard:${c}`))
}

beforeEach(() => {
  delete window.__omniconnectHost__

  useLeadStore.setState({
    isLoadingDashboard: false,
    kpiSummary: {
      totalLeads: 42,
      newLeads: 7,
      inProgressLeads: 5,
      convertedLeads: 3,
      conversionRate: 12.5,
    } as never,
  })
})

describe('gating', () => {
  it('shows only the cards that were granted', () => {
    grantCards('kpi.new-leads', 'kpi.converted')

    render(<KpiCardSection />)

    expect(screen.getByText('New Leads')).toBeInTheDocument()
    expect(screen.getByText('Converted')).toBeInTheDocument()
    expect(screen.queryByText('Total Leads')).not.toBeInTheDocument()
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument()
    expect(screen.queryByText('Conversion Rate')).not.toBeInTheDocument()
  })

  it('removes an ungranted card rather than showing it empty', () => {
    // The value must go with the label. Leaving "42" on screen under a hidden heading would defeat
    // the whole exercise.
    grantCards('kpi.new-leads')

    render(<KpiCardSection />)

    expect(screen.queryByText('Total Leads')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
  })

  it('renders nothing at all when no card was granted', () => {
    // An empty bordered grid is worse than no grid: it looks like content failed to arrive.
    grantCards()

    const { container } = render(<KpiCardSection />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows every card to a user granted all five', () => {
    grantCards(
      'kpi.total-leads',
      'kpi.new-leads',
      'kpi.in-progress',
      'kpi.converted',
      'kpi.conversion-rate',
    )

    render(<KpiCardSection />)

    for (const label of ['Total Leads', 'New Leads', 'In Progress', 'Converted', 'Conversion Rate']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('does not treat a grant on a different app as a grant here', () => {
    bridgeGranting('remote.customer360.profile:kpi.total-leads')

    const { container } = render(<KpiCardSection />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('values', () => {
  it('renders the number for a granted card', () => {
    grantCards('kpi.total-leads')

    render(<KpiCardSection />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders a dash when the server withheld the number', () => {
    /*
     * The two halves meeting. The server redacts an ungranted card to null rather than zero, because
     * "no leads" and "you may not see this" are different facts — so the client must not render null
     * as 0 and re-tell the lie the null was avoiding.
     */
    grantCards('kpi.total-leads')
    useLeadStore.setState({
      kpiSummary: { totalLeads: null, newLeads: 7 } as never,
    })

    render(<KpiCardSection />)

    expect(screen.getByText('-')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('formats a rate as a percentage', () => {
    grantCards('kpi.conversion-rate')

    render(<KpiCardSection />)

    expect(screen.getByText('12.5%')).toBeInTheDocument()
  })
})
