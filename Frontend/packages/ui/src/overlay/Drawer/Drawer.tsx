import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import { Icon } from '../../primitives/Icon/Icon'
import styles from './Drawer.module.css'

export type DrawerTone = 'brand' | 'danger'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** Rendered left of the title inside the blue header — typically an Icon. */
  icon?: ReactNode
  /** Panel width. Defaults to the host's `min(700px, 94vw)`. */
  width?: string
  /** Sticky action row pinned below the scrolling body. Omit for a read-only drawer. */
  footer?: ReactNode
  children: ReactNode
  className?: string
  /** Accessible label for the close button. Override when "Close" is ambiguous on the screen. */
  closeLabel?: string
  /**
   * Header treatment. `danger` is for destructive confirmations only — it is a semantic signal, not
   * decoration, so do not reach for it to make a drawer stand out.
   */
  tone?: DrawerTone
}

/**
 * Right-side drawer: overlay, backdrop, sliding panel, blue header, scrolling body, optional footer.
 *
 * Rendered IN-TREE, not through a portal, and that is a deliberate constraint rather than an
 * oversight. Both remotes run `postcss-prefix-selector`, which prefixes every selector with
 * `#lead-mf-scope` / `#customer360-mf-scope`; anything portalled to document.body lands outside that
 * scope and silently loses all of its styling. The host's own Modal and all five lead drawers
 * already render in-tree for this reason. If a portal ever becomes necessary here, the portal target
 * must itself be wrapped in the consuming app's scope id — see HostSidebarLeadNav for that pattern.
 *
 * The consumer owns everything behind the chrome: content, data fetching, validation, actions and
 * business rules. This component only knows how a drawer should look and how it closes.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  width,
  footer,
  children,
  className,
  closeLabel = 'Close',
  tone = 'brand',
}: DrawerProps) {
  // Escape-to-close was implemented in some drawers and forgotten in others; making it part of the
  // shared component means every drawer in the platform behaves the same way.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlayRoot} role="dialog" aria-modal="true">
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      {/* Custom-property hand-off — the only inline style the repo convention allows, because the
          width is a runtime value. The `width` declaration itself lives in Drawer.module.css. */}
      <div
        className={classNames(styles.container, className)}
        style={width ? ({ '--omni-drawer-width': width } as CSSProperties) : undefined}
      >
        <header className={classNames(styles.header, tone === 'danger' && styles.headerDanger)}>
          <div className={styles.headerLeft}>
            {/* Wrapped rather than rendered bare, so every drawer gets the same glass tile and a
                consumer only ever supplies the glyph. */}
            {icon ? <div className={styles.headerIcon}>{icon}</div> : null}
            <div>
              <h2 className={styles.title}>{title}</h2>
              {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={closeLabel}>
            <Icon.X width={18} height={18} />
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  )
}

export { styles as drawerStyles }
