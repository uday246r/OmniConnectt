import { resolveIcon } from '@omniconnect/ui';
import styles from './CatalogIcon.module.css';

export interface CatalogIconProps {
  /** The stored key. An unknown or empty one falls back to the generic box, never to a blank tile. */
  iconKey?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

/** A catalogue record's icon, on a tinted tile. Decorative: the record's name always sits beside it. */
export function CatalogIcon({ iconKey, size = 'md' }: CatalogIconProps) {
  const Glyph = resolveIcon(iconKey);
  return (
    <span className={`${styles.tile} ${styles[size]}`} aria-hidden="true">
      <Glyph />
    </span>
  );
}
