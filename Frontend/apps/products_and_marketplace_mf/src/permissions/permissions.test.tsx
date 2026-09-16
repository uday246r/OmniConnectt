import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { featureKeyFor, hasCapability } from '../api/hostBridge'
import { PlatformPermissionProvider, usePermissions } from './PermissionContext'
import { PERMISSIONS } from './permissions'

/**
 * The buttons this remote shows are the ones the signed-in user may actually use.
 *
 * Every permission used to be granted to everyone through a mock provider, under key names the host
 * never issues. The checks now go to the host bridge with the same `remote.<app>.<module>:<Capability>`
 * strings the backend enforces, so what the screen offers and what the server allows cannot disagree.
 */

afterEach(() => {
  delete window.__omniconnectHost__
})

function installBridge(granted: string[], isAdministrator = false) {
  const hasCap = vi.fn((feature: string, capability: string) => granted.includes(`${feature}:${capability}`))
  window.__omniconnectHost__ = {
    getAccessToken: () => 't',
    ensureFreshAccessToken: () => Promise.resolve('t'),
    hasCapability: hasCap,
    getUser: () => ({ id: 'u', name: 'U', email: 'u@example.com', isAdministrator, roleName: null, permissions: [] }),
  }
  return hasCap
}

describe('permission keys', () => {
  it('match the strings the backend enforces', () => {
    expect(featureKeyFor('products')).toBe('remote.products.products')
    expect(PERMISSIONS.PRODUCTS_DELETE).toBe('products:Delete')
    expect(PERMISSIONS.AUDIT_LOGS_VIEW).toBe('audit:View')
    expect(PERMISSIONS.REVIEWS_MANAGE).toBe('reviews:Moderate')
  })

  it('asks the host with the full feature key', () => {
    const hasCap = installBridge(['remote.products.products:Delete'])

    expect(hasCapability('products', 'Delete')).toBe(true)
    expect(hasCap).toHaveBeenCalledWith('remote.products.products', 'Delete')
    expect(hasCapability('products', 'Create')).toBe(false)
  })

  it('lets administrators through without asking', () => {
    const hasCap = installBridge([], true)

    expect(hasCapability('setup', 'Manage')).toBe(true)
    expect(hasCap).not.toHaveBeenCalled()
  })
})

function Probe() {
  const { has } = usePermissions()
  return (
    <ul>
      <li>{has(PERMISSIONS.PRODUCTS_CREATE) ? 'can create' : 'cannot create'}</li>
      <li>{has(PERMISSIONS.PRODUCTS_DELETE) ? 'can delete' : 'cannot delete'}</li>
    </ul>
  )
}

describe('screens', () => {
  it('show only what the signed-in user was granted', () => {
    installBridge(['remote.products.products:Create'])

    render(
      <PlatformPermissionProvider>
        <Probe />
      </PlatformPermissionProvider>,
    )

    expect(screen.getByText('can create')).toBeInTheDocument()
    expect(screen.getByText('cannot delete')).toBeInTheDocument()
  })

  it('ask the host even without a provider, instead of granting everything', () => {
    installBridge([])

    render(<Probe />)

    expect(screen.getByText('cannot create')).toBeInTheDocument()
  })
})
