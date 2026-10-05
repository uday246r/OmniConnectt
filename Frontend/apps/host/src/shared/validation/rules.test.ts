import { describe, expect, it } from 'vitest'
import { manifestUrl } from './rules'

/**
 * The Applications form's manifest-URL rule, the browser twin of AuthService's ManifestUrlPolicy.
 *
 * Remotes are now served from the platform's own origin under a versioned folder, and the form used
 * to reject every such path as "not a full absolute URL" — so an administrator could not register an
 * app the way production requires. These pin that the normal shape is accepted, that an app cannot
 * point at another app's folder, and that a non-http scheme is still refused.
 */
describe('manifestUrl', () => {
  it('accepts a versioned path under the app’s own folder', () => {
    expect(manifestUrl('/modules/lead/4.7.3/mf-manifest.json', 'lead')).toBeUndefined()
  })

  it('refuses a path under another app’s folder', () => {
    expect(manifestUrl('/modules/customer360/2.0.0/mf-manifest.json', 'lead')).toMatch(/\/modules\/lead\//)
  })

  it('refuses a path that is not one versioned manifest', () => {
    expect(manifestUrl('/modules/lead/mf-manifest.json', 'lead')).toBeDefined()
    expect(manifestUrl('/modules/lead/1.0.0/remoteEntry.js', 'lead')).toBeDefined()
  })

  it('leaves an absolute http(s) URL for the server to judge, but refuses other schemes', () => {
    expect(manifestUrl('http://127.0.0.1:5002/mf-manifest.json', 'lead')).toBeUndefined()
    expect(manifestUrl('javascript:alert(1)', 'lead')).toMatch(/http/)
  })

  it('names the folder to use before a key has been typed', () => {
    expect(manifestUrl('/modules/x', '')).toContain('/modules/<key>/')
  })
})
