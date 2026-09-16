/**
 * Product identity, in one place.
 *
 * Previously the product name was typed as a literal in four separate components, which had already
 * drifted — the sidebar and dashboard footer said "OmniConnect" while the login form said
 * "OmniConnect", on the same deployment. A bank deploying this will almost certainly want its own
 * name here, so the value is configuration rather than source.
 *
 * `VITE_` prefixed vars are the only ones Vite exposes to the browser bundle, and they are inlined
 * at build time — so this is a build-time setting, not a runtime one. That is the right trade-off
 * for a brand name (it never changes between requests) and avoids an extra network round trip on
 * first paint just to learn what to call ourselves.
 *
 * NOTE: the Module Federation bridge names (`OmniConnectHostBridge`, `window.__omniconnectHost__`) are
 * deliberately NOT derived from this. They are a published API contract that remote applications
 * compile against, so renaming the product must not silently break every remote.
 */

/** Display name of the platform, e.g. in the sidebar brand and the login form. */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME || 'OmniConnect'

/**
 * Build identifier shown in the dashboard footer. Empty by default rather than a made-up version —
 * the footer omits the segment entirely when this isn't set, instead of asserting a "v1.2.0" that
 * corresponds to no actual build.
 */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || ''

/**
 * Copyright year. Computed, not typed — the previous hardcoded "© 2026" would silently be wrong on
 * 1 January, in a footer nobody thinks to re-check.
 */
export const COPYRIGHT_YEAR: number = new Date().getFullYear()
