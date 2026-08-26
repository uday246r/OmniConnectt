/*
 * The four primitives now live in @omniremit/ui so the remotes use the same ones rather than their
 * own copies — re-exported here so every existing host import keeps working unchanged.
 *
 * The card-level skeletons below stay local on purpose: each is an exact shape match for a specific
 * host card, which is what makes them worth having (no layout shift when the real content arrives),
 * and that shape is not something a remote would ever want.
 */
export { SkeletonBlock, SkeletonText, SkeletonAvatar, SkeletonTable } from '@omniremit/ui/skeleton'
export type { SkeletonBlockProps } from '@omniremit/ui/skeleton'

// Card-level skeletons — exact shape matches for zero CLS
export { SkeletonUserCard } from './SkeletonUserCard'
export { SkeletonRoleCard } from './SkeletonRoleCard'
export { SkeletonAppCard } from './SkeletonAppCard'
export { SkeletonStatCard } from './SkeletonStatCard'
export { SkeletonAuditRow } from './SkeletonAuditRow'
export { SkeletonOverviewActivity } from './SkeletonOverviewActivity'
export { SkeletonDashboardWidget } from './SkeletonDashboardWidget'
export { SkeletonDonutChart } from './SkeletonDonutChart'
