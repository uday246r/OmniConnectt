import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserDetailSkeleton } from './UserDetailSkeleton'

describe('UserDetailSkeleton', () => {
  it('renders accessible status wrapper with shimmer blocks', () => {
    render(<UserDetailSkeleton />)

    // Accessible status indicator
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/loading user details/i)).toBeInTheDocument()
  })

  it('does NOT render real section titles or field labels', () => {
    render(<UserDetailSkeleton />)

    // Skeleton is pure geometry — no real text content should leak through
    expect(screen.queryByText('Identity')).not.toBeInTheDocument()
    expect(screen.queryByText('Access')).not.toBeInTheDocument()
    expect(screen.queryByText('Full Name')).not.toBeInTheDocument()
    expect(screen.queryByText('Email')).not.toBeInTheDocument()
    expect(screen.queryByText('Role')).not.toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })
})
