import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Icon, useAnchoredPopover } from '@omniconnect/ui';
import styles from './RowMenu.module.css';

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  /** Drawn as a destructive choice. */
  danger?: boolean;
  disabled?: boolean;
}

export interface RowMenuProps {
  /** What the button is called for a screen reader — name the row, e.g. "Actions for Home Loan". */
  label: string;
  items: RowMenuItem[];
}

/**
 * The "…" menu at the end of a table row.
 *
 * Positioned against the button but rendered outside the table, so a scrolling table cannot clip it.
 * Escape and a click elsewhere close it (the shared popover hook handles both).
 */
export function RowMenu({ label, items }: RowMenuProps) {
  const { open, setOpen, anchorRef, popoverRef, coords, popoverId } = useAnchoredPopover<HTMLButtonElement>({ minWidth: 190 });

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon.MoreHorizontal />
      </button>
      {open &&
        coords &&
        createPortal(
          <div ref={popoverRef} id={popoverId} role="menu" className={styles.menu} style={{ top: coords.top, left: coords.left }}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={`${styles.item} ${item.danger ? styles.danger : ''}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
