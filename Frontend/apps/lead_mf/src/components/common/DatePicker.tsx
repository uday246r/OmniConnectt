import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from '@omniconnect/ui/icons';
import styles from './DatePicker.module.css';

interface DatePickerProps {
  id?: string;
  label?: string;
  value: string; // DD/MM/YYYY format
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_HEADER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const DatePicker: React.FC<DatePickerProps> = ({
  id,
  label,
  value,
  onChange,
  required = false,
  error,
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
    const formattedDay = day < 10 ? `0${day}` : `${day}`;
    const formattedMonth = viewMonth + 1 < 10 ? `0${viewMonth + 1}` : `${viewMonth + 1}`;
    const formattedDate = `${formattedDay}/${formattedMonth}/${viewYear}`;
    onChange(formattedDate);
    setIsOpen(false);
  };

  // Generate calendar days
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();

  // Year range generator (e.g. 1970 to 2030)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 60 }, (_, i) => currentYear - 45 + i);

  return (
    <div className="form-field-group" ref={containerRef} id={id}>
      {label && (
        <label className="form-label">
          {label} {required && <span className="required-asterisk">*</span>}
        </label>
      )}

      <div className={styles.container}>
        <div
          className={`dropdown-trigger ${isOpen ? 'open' : ''} ${error ? 'has-error' : ''} ${
            !value ? 'placeholder-text' : ''
          }`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          role="button"
          tabIndex={disabled ? -1 : 0}
          style={disabled ? { cursor: 'not-allowed', opacity: 0.6, background: '#f1f5f9' } : undefined}
        >
          <span>{value || placeholder}</span>
          <div className={styles.triggerRow}>
            {value && !disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                }}
                className={styles.calendarIcon}
              >
                <X size={14} />
              </button>
            )}
            <CalendarIcon size={16} className={styles.footerRow} />
          </div>
        </div>

        {isOpen && !disabled && (
          <div className="date-picker-popup">
            {/* Header with Month / Year selection */}
            <div className="date-picker-header">
              <button
                type="button"
                className="date-picker-nav-btn"
                onClick={handlePrevMonth}
                title="Previous Month"
              >
                <ChevronLeft size={16} />
              </button>

              <div className={styles.clearBtn}>
                <select
                  value={viewMonth}
                  onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                  className={styles.todayBtn}
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
                  className={styles.todayBtn}
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
                className="date-picker-nav-btn"
                onClick={handleNextMonth}
                title="Next Month"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Days Grid */}
            <div className="date-picker-grid">
              {DAYS_HEADER.map((d) => (
                <div key={d} className="date-picker-day-head">
                  {d}
                </div>
              ))}

              {/* Blank leading days */}
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <div key={`blank-${i}`} className="date-picker-cell empty" />
              ))}

              {/* Month Days */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const formattedDay = day < 10 ? `0${day}` : `${day}`;
                const formattedMonth = viewMonth + 1 < 10 ? `0${viewMonth + 1}` : `${viewMonth + 1}`;
                const isSelected = value === `${formattedDay}/${formattedMonth}/${viewYear}`;

                return (
                  <div
                    key={`day-${day}`}
                    className={`date-picker-cell ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectDay(day)}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && <div className="field-error-message">{error}</div>}
    </div>
  );
};
