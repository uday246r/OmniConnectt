/**
 * Loading-state primitives, shared by the host and every remote.
 *
 * These four are the generic building blocks. Page-shaped skeletons — the ones that mirror a
 * particular card or table — deliberately stay next to the page they imitate, because their whole
 * job is to match a layout only that page knows about.
 *
 * The shimmer moved here because it had already been copy-pasted twice: lead_mf carried a `.lead-skel`
 * class and customer360_mf a `.c360-skel`, both hand-rolled reimplementations of the host's `.shimmer`
 * with the same gradient and timing, separately maintained. One implementation now, so a loading state
 * looks the same wherever it appears.
 */
export { SkeletonBlock } from './SkeletonBlock'
export type { SkeletonBlockProps } from './SkeletonBlock'
export { SkeletonText } from './SkeletonText'
export { SkeletonAvatar } from './SkeletonAvatar'
export { SkeletonTable } from './SkeletonTable'
