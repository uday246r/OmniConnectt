import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

export interface SkeletonBlockProps {
  width?: string | number
  height?: string | number
  radius?: string
  className?: string
}

/** A single shimmering rectangle — the base primitive the other Skeleton components build on. */
export function SkeletonBlock({ width = '100%', height = '100%', radius, className }: SkeletonBlockProps) {
  const style: CSSProperties = { width, height, borderRadius: radius }
  return <div className={[styles.shimmer, styles.block, className].filter(Boolean).join(' ')} style={style} aria-hidden="true" />
}
