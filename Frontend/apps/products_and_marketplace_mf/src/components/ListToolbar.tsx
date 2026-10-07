import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, SearchField, Select, useDebouncedValue, type SelectOption } from '@omniconnect/ui';
import styles from './ListToolbar.module.css';

export interface ListToolbarProps {
  searchLabel: string;
  searchPlaceholder: string;
  /** The search the list is currently filtered by. */
  search: string;
  onSearchChange: (search: string) => void;

  /** Statuses to filter by, in Setup's order. Omit to hide the filter. */
  statusOptions?: SelectOption[];
  status?: string;
  onStatusChange?: (status: string) => void;

  sortOptions?: SelectOption[];
  sort?: string;
  onSortChange?: (sort: string) => void;

  /** Filters particular to a screen (a category picker), placed before the status filter. */
  children?: ReactNode;

  /** Whether anything differs from the default view, so Reset is only offered when it would do something. */
  canReset: boolean;
  onReset: () => void;

  /**
   * Actions after Reset, pushed to the right of the row — Refresh, rows per page.
   *
   * Separate from `children` on purpose: `children` are filters, which belong with the other filters
   * before the status select, while these act on the list as a whole. The host puts exactly these two
   * in a right-aligned cluster at the end of its own toolbars.
   */
  trailing?: ReactNode;
}

const SEARCH_PAUSE_MS = 300;

/**
 * The search box, filters and Reset above a list.
 *
 * Typing does not query on every keystroke: the search is committed after a short pause. The one subtle
 * part is keeping the box and the committed search in step without either overwriting the other — a
 * pause that fires while the person is still typing must not put the older text back, and Reset must
 * clear what is on screen. `emitted` remembers what this box last committed so only a change from
 * elsewhere is copied in.
 */
export function ListToolbar({
  searchLabel, searchPlaceholder, search, onSearchChange,
  statusOptions, status, onStatusChange,
  sortOptions, sort, onSortChange,
  children, canReset, onReset, trailing,
}: ListToolbarProps) {
  const [text, setText] = useState(search);
  const debounced = useDebouncedValue(text, SEARCH_PAUSE_MS);
  const emitted = useRef(search);

  useEffect(() => {
    if (debounced !== emitted.current) {
      emitted.current = debounced;
      onSearchChange(debounced);
    }
    // onSearchChange is deliberately not a dependency: a new callback identity must not re-commit the same text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    if (search !== emitted.current) {
      emitted.current = search;
      setText(search);
    }
  }, [search]);

  return (
    <div className={styles.toolbar} role="search" aria-label={searchLabel}>
      <SearchField
        className={styles.search}
        value={text}
        onValueChange={setText}
        placeholder={searchPlaceholder}
        aria-label={searchLabel}
      />
      {children}
      {statusOptions && onStatusChange && (
        <div className={styles.control}>
          <Select
            aria-label="Filter by status"
            options={statusOptions}
            value={status ?? ''}
            placeholder="All statuses"
            clearLabel="All statuses"
            onChange={(event) => onStatusChange(event.target.value)}
          />
        </div>
      )}
      {sortOptions && onSortChange && (
        <div className={styles.control}>
          <Select
            aria-label="Sort by"
            options={sortOptions}
            value={sort ?? ''}
            onChange={(event) => onSortChange(event.target.value)}
          />
        </div>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onReset} disabled={!canReset}>
          Reset
        </Button>
        {trailing}
      </div>
    </div>
  );
}
