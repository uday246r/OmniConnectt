import styles from './Skeleton.module.css'

export interface SkeletonAvatarProps {
  size?: number
}

export function SkeletonAvatar({ size = 32 }: SkeletonAvatarProps) {
  return (
    <div
      className={[styles.shimmer, styles.avatar].join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
