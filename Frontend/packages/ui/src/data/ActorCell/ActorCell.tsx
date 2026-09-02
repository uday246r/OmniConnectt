import { classNames } from '../../utils/classNames'
import styles from './ActorCell.module.css'

export interface ActorCellProps {
  /** The person's display name. When absent the cell renders `fallback`. */
  name?: string | null
  /** Secondary line — an email or a role. Optional; the host's login tab uses it. */
  meta?: string | null
  /**
   * What to show when there is no name — typically a raw identifier. Rendered in the MUTED
   * treatment rather than the bold one reserved for people's names, so an id never masquerades as
   * a name. Defaults to "Unknown".
   */
  fallback?: string | null
  className?: string
}

/** First letter of the name, for the avatar tile. Falls back to "S" for System, as the host does. */
function initialOf(name?: string | null): string {
  const trimmed = (name ?? '').trim()
  return (trimmed.charAt(0) || 'S').toUpperCase()
}

/**
 * "Who did this" in an audit table row: a lettered avatar tile plus the name on one line.
 *
 * Global shared: the host's Audit Logs and lead_mf's both had their own `.actorCell`;
 * customer360_mf had none at all and rendered `{log.user}` as bare text. Because the value it
 * receives is often a raw identifier ("User 60892301-eded-47ce-be0b-09a5823bc2bc"), that bare text
 * wrapped over five lines and forced every row in the c360 audit table to 124px tall. The name here
 * is truncated with an ellipsis and the full value is kept in `title`, so a row stays one line high
 * and the identifier is still recoverable on hover.
 */
export function ActorCell({ name, meta, fallback, className }: ActorCellProps) {
  const display = (name ?? '').trim()
  const fallbackText = (fallback ?? '').trim()

  return (
    <div className={classNames(styles.cell, className)}>
      <span className={styles.avatar} aria-hidden="true">
        {initialOf(display)}
      </span>
      <span className={styles.text}>
        {display ? (
          <span className={styles.name} title={display}>
            {display}
          </span>
        ) : (
          <span className={styles.unknown} title={fallbackText || undefined}>
            {fallbackText || 'Unknown'}
          </span>
        )}
        {meta ? (
          <span className={styles.meta} title={meta}>
            {meta}
          </span>
        ) : null}
      </span>
    </div>
  )
}
