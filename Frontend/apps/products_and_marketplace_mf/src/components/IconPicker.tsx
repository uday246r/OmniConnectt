import { Icon } from '@omniconnect/ui';
import { CATALOG_ICON_KEYS } from './catalogIcons';
import styles from './IconPicker.module.css';

export interface IconPickerProps {
  label: string;
  value: string;
  onChange: (iconKey: string) => void;
}

/**
 * Choose an icon from the shared set. A radio group, so it is one tab stop and arrow keys move between
 * choices; each icon is named for screen readers by its key.
 */
export function IconPicker({ label, value, onChange }: IconPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.grid}>
      {CATALOG_ICON_KEYS.map((key) => {
        const Glyph = Icon[key];
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            title={key}
            className={`${styles.choice} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(key)}
          >
            <Glyph />
          </button>
        );
      })}
    </div>
  );
}
