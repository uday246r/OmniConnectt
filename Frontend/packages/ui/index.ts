/**
 * Code shared by the host and every remote.
 *
 * Consumed as a pnpm workspace dependency (`workspace:*`), the same way
 * `@omniremit/federation-config` already is — a build-time import, deliberately not a Module
 * Federation export. Federation would add runtime coupling and version skew between independently
 * deployed remotes; a workspace package gives each app the same source at build time with neither.
 *
 * Starts with validation, which is where the divergence was doing real damage: the same phone number
 * was judged three incompatible ways across the platform. Shared UI components follow.
 */
export * from './src/validation'
