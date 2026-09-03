import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './DetailPanel.module.css'

/**
 * The read-only "what happened" panel used inside a details drawer.
 *
 * The host, lead_mf and customer360_mf each had their own copy of this markup — identical CSS
 * values, three separate stylesheets — and each repeated the same decision about what to render
 * when a value is missing. They disagreed: one printed "Not recorded", one an em dash, one
 * "System / None", and several invented a plausible-looking default instead.
 *
 * `DetailField` makes the rule structural: **a field with no value renders nothing at all.** A
 * caller cannot accidentally show an empty row, and cannot fabricate a value to fill one, because
 * the component decides. That matters most here — this panel is an audit trail, and a made-up
 * value in an audit trail is worse than an absent one.
 */

/** Values that mean "the backend gave us nothing", including the placeholders pages used to pass. */
function isEmpty(value: ReactNode): boolean {
  if (value === null || value === undefined || value === false) return true
  if (typeof value === 'string') {
    const v = value.trim()
    return v === '' || v === '—' || v === '-' || v.toLowerCase() === 'null' || v.toLowerCase() === 'undefined'
  }
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty)
  return false
}

export interface DetailSectionProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  /**
   * Render nothing when every field inside resolved to empty. Pass the same emptiness test the
   * caller used to build the children — a section whose fields all vanished should vanish too,
   * rather than leaving a titled empty box.
   */
  hidden?: boolean
}

export function DetailSection({ title, icon, children, hidden }: DetailSectionProps) {
  if (hidden) return null
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Two-column grid of fields; collapses to one column on narrow viewports. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>
}

export interface DetailFieldProps {
  label: string
  icon?: ReactNode
  /** Rendered as the value. When empty, the whole field is omitted. */
  children?: ReactNode
  /** Span both grid columns — for long free text such as a description. */
  full?: boolean
  /** Render the value in the platform monospace face. */
  mono?: boolean
}

export function DetailField({ label, icon, children, full, mono }: DetailFieldProps) {
  if (isEmpty(children)) return null
  return (
    <div className={classNames(styles.field, full && styles.fieldFull)}>
      {icon ? <span className={styles.fieldIcon}>{icon}</span> : null}
      <div className={styles.fieldBody}>
        <span className={styles.fieldLabel}>{label}</span>
        <span className={classNames(styles.fieldValue, mono && styles.mono)}>{children}</span>
      </div>
    </div>
  )
}

/** Wrapper for the stacked sections that make up a drawer body. */
export function DetailSections({ children }: { children: ReactNode }) {
  return <div className={styles.sections}>{children}</div>
}

export { isEmpty as isEmptyDetailValue }
