import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from '@omniconnect/ui/icons';
import styles from './DatePicker.module.css';

interface DatePickerProps {
  /** The id of the trigger, so a FormField's label names it. */
  id?: string;
  value: string; // DD/MM/YYYY format
  onChange: (value: string) => void;
  /** True while the field has an error — drawn as the invalid border. */
  invalid?: boolean;
  /** The id of the field's message line, from FormField. */
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * The calendar control, and nothing around it.
 *
 * It used to render its own label, its own required marker and its own error line, in a third set of
 * form classes. Those now come from the shared `FormField` it is placed inside, which also hands it
 * the id and the message to point at, so the label genuinely names the trigger. Its trigger and
 * popup were the last things in this app still drawn by the global `.dropdown-trigger` /
 * `.date-picker-*` rules in index.css; they are now a module that matches the shared Input, so the
 * date field looks like the field beside it.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_HEADER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export const DatePicker: React.FC<DatePickerProps> = ({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  placeholder = 'DD/MM/YYYY',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse existing value or default to current date
  let initialDate = new Date();
  if (value) {
    const parts = value.split('/');
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
        initialDate = new Date(y, m, d);
      }
    }
  }

  const [viewYear, setViewYear] = useState<number>(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialDate.getMonth());

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape closes the calendar without choosing, and returns focus to the trigger — otherwise the
  // only way out of an opened calendar is the mouse.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      containerRef.current?.querySelector<HTMLElement>(`.${styles.trigger}`)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    onChange(`${pad(day)}/${pad(viewMonth + 1)}/${viewYear}`);
    setIsOpen(false);
  };

  // Generate calendar days
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();

  // Year range generator (e.g. 1970 to 2030)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 60 }, (_, i) => currentYear - 45 + i);

  const today = new Date();
  const isCurrentMonthInView =
    today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  const triggerClass = [
    styles.trigger,
    isOpen ? styles.open : '',
    invalid ? styles.invalid : '',
    !value ? styles.placeholder : '',
    disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef} className={styles.container}>
      <div
        id={id}
        className={triggerClass}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        tabIndex={disabled ? -1 : 0}
      >
        <span>{value || placeholder}</span>
        <div className={styles.triggerActions}>
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className={styles.clearButton}
            >
              <X size={14} />
            </button>
          )}
          <CalendarIcon size={16} className={styles.calendarGlyph} />
        </div>
      </div>

      {isOpen && !disabled && (
        <div className={styles.popup} role="dialog" aria-label="Choose a date">
          {/* Header with Month / Year selection */}
          <div className={styles.popupHeader}>
            <button
              type="button"
              className={styles.navButton}
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>

            <div className={styles.monthYear}>
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                className={styles.monthYearSelect}
                aria-label="Month"
                onClick={(e) => e.stopPropagation()}
              >
                {MONTHS.map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                className={styles.monthYearSelect}
                aria-label="Year"
                onClick={(e) => e.stopPropagation()}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={styles.navButton}
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Days Grid */}
          <div className={styles.grid}>
            {DAYS_HEADER.map((d) => (
              <div key={d} className={styles.dayHead}>
                {d}
              </div>
            ))}

            {/* Blank leading days */}
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`blank-${i}`} className={styles.blank} />
            ))}

            {/* Month Days */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isSelected = value === `${pad(day)}/${pad(viewMonth + 1)}/${viewYear}`;
              const isToday = isCurrentMonthInView && today.getDate() === day;

              return (
                <button
                  key={`day-${day}`}
                  type="button"
                  className={[styles.cell, isSelected ? styles.selected : '', isToday ? styles.today : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectDay(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
