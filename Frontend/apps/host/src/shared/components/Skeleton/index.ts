/*
 * The host's skeleton barrel.
 *
 * The four PRIMITIVES now come straight from @omniconnect/ui — they were byte-compatible duplicates
 * of the shared ones, and a shimmer that differs between the host and a remote is exactly the kind
 * of drift the shared package exists to prevent. Every existing
 * `from '…/shared/components/Skeleton'` import keeps working unchanged.
 *
 * The CARD-LEVEL skeletons below stay local on purpose: each one is shape-matched to a specific
 * host card so the page does not shift when real content arrives. They describe host layouts, so
 * they are not shareable and do not belong in the platform package.
 */
export {
  SkeletonBlock,
  SkeletonText,
  SkeletonAvatar,
  SkeletonTable,
} from '@omniconnect/ui'
export type {
  SkeletonBlockProps,
  SkeletonTextProps,
  SkeletonAvatarProps,
  SkeletonTableProps,
} from '@omniconnect/ui'

// Card-level skeletons — exact shape matches for zero CLS. Host-specific.
export { SkeletonUserCard } from './SkeletonUserCard'
export { SkeletonRoleCard } from './SkeletonRoleCard'
export { SkeletonAppCard } from './SkeletonAppCard'
export { SkeletonStatCard } from './SkeletonStatCard'
export { SkeletonAuditRow } from './SkeletonAuditRow'
export { SkeletonOverviewActivity } from './SkeletonOverviewActivity'
export { SkeletonDashboardWidget } from './SkeletonDashboardWidget'
export { SkeletonDonutChart } from './SkeletonDonutChart'
export { UserDetailSkeleton } from '../../../features/settings-users/components/UserDetailSkeleton/UserDetailSkeleton'
