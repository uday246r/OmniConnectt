import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStatusConfigStore } from '../../stores/useStatusConfigStore'
import type { StatusConfig } from '../../types/domain'
import { StatusCountCards } from './StatusCountCards'

/**
 * The cards above Applications and Promotions.
 *
 * They used to count the rows of the page on screen under status names written in code. They now show
 * the server's whole-set counts, labelled by Setup's status configuration — so these tests check that
 * the total is the sum, that the busiest statuses are shown under their configured labels, and that a
 * status Setup has never heard of still shows (under its raw value) instead of disappearing.
 */
beforeEach(() => {
  useStatusConfigStore.setState({
    loaded: true,
    configs: [
      { id: '1', entityType: 'Application', value: 'UnderReview', label: 'Under Review', color: 'warning', enabled: true, sortOrder: 1 },
      { id: '2', entityType: 'Application', value: 'Approved', label: 'Approved', color: 'success', enabled: true, sortOrder: 2 },
    ] as StatusConfig[],
  })
})

describe('StatusCountCards', () => {
  it('shows the total of every status and the three busiest under their configured labels', () => {
    render(
      <StatusCountCards
        entityType="Application"
        totalLabel="Applications"
        totalIcon="file"
        loading={false}
        counts={[
          { status: 'Approved', count: 1200 },
          { status: 'UnderReview', count: 30 },
          { status: 'Escalated', count: 7 },
          { status: 'Draft', count: 2 },
        ]}
      />,
    )

    expect(screen.getByText('Applications').closest('.pm-kpi-card')).toHaveTextContent('1,239')
    expect(screen.getByText('Approved').closest('.pm-kpi-card')).toHaveTextContent('1,200')
    expect(screen.getByText('Under Review').closest('.pm-kpi-card')).toHaveTextContent('30')
    expect(screen.getByText('Escalated')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows a placeholder, not zero, while the counts are loading', () => {
    render(<StatusCountCards entityType="Application" totalLabel="Applications" totalIcon="file" loading counts={null} />)

    expect(screen.getByText('Applications').closest('.pm-kpi-card')).toHaveTextContent('—')
  })
})
