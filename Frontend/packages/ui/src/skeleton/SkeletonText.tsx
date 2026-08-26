import styles from './Skeleton.module.css'

export interface SkeletonTextProps {
  lines?: number
  lastLineWidth?: string
}

/** A block of shimmering text lines, e.g. for a card description while it loads. */
export function SkeletonText({ lines = 1, lastLineWidth = '70%' }: SkeletonTextProps) {
  return (
    <div className={styles.textGroup} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={[styles.shimmer, styles.text].join(' ')}
          style={{ width: i === lines - 1 && lines > 1 ? lastLineWidth : '100%' }}
        />
      ))}
    </div>
  )
}
