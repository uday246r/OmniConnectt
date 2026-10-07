import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './FormSection.module.css'

export interface FormSectionProps {
  /** The group's name. Omit for an untitled card that only needs the chrome. */
  title?: string
  /** A glyph before the name. Decorative — the title is what names the group. */
  icon?: ReactNode
  /** One quiet line under the title, for a rule that is not obvious from the field names. */
  description?: string
  /** Controls opposite the title — an "Add row" button, a count, a switch. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * One group of fields in a form, as a titled card.
 *
 * A long form read as one undifferentiated column of inputs in both remotes while the host grouped
 * its fields into cards, and that was the single biggest reason the same form looked like two
 * different products. Everything here is copied from the host's own form layer
 * (`UserFormLayer.module.css`), which is the design reference for this package.
 *
 * Stacking is left to the caller: every form already has a container for it, and a card that also
 * owned the gap above it could not be put anywhere else.
 */
export function FormSection({ title, icon, description, actions, children, className }: FormSectionProps) {
  return (
    <section className={classNames(styles.card, className)}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && (
            <h3 className={styles.title}>
              {icon && (
                <span className={styles.icon} aria-hidden="true">
                  {icon}
                </span>
              )}
              {title}
            </h3>
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      {description && <p className={styles.description}>{description}</p>}
      {children}
    </section>
  )
}
