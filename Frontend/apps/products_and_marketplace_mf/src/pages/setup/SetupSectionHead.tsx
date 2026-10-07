import type { ReactNode } from 'react';
import styles from './setup.module.css';

export interface SetupSectionHeadProps {
  icon: ReactNode;
  title: string;
  /** One or two sentences on what this part of Setup decides. */
  hint: ReactNode;
  /** The section's own action — "Add field", "Add document". */
  action?: ReactNode;
}

/**
 * The header of a Setup card: an icon tile, the title, what it is for, and its action.
 *
 * Each tab used to write this out by hand with a small rule-and-label title borrowed from form
 * groups, which is the right weight for a cluster of fields inside a drawer and too slight for the
 * heading of a full-width card — the card read as untitled. This is the panel heading the dashboard
 * cards use, with the icon tile the stat tiles use, so a Setup card looks like the other cards on the
 * platform.
 */
export function SetupSectionHead({ icon, title, hint, action }: SetupSectionHeadProps) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionIcon} aria-hidden="true">{icon}</span>
      <div className={styles.sectionText}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        <p className={styles.sectionHint}>{hint}</p>
      </div>
      {action && <div className={styles.sectionAction}>{action}</div>}
    </div>
  );
}
