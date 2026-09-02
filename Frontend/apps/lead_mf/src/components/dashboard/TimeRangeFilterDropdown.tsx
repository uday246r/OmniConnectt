import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, Check, RotateCcw } from 'lucide-react';
import styles from './TimeRangeFilterDropdown.module.css';
import { useLeadStore } from '../../store/useLeadStore';

export interface TimeRangePreset {
  id: string;
  label: string;
}

const PRESETS: TimeRangePreset[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'all_time', label: 'All Time' },
  { id: 'custom', label: 'Custom Range' },
];

export const TimeRangeFilterDropdown: React.FC = () => {
  const {
    dashboardDatePreset,
    dashboardStartDate,
    dashboardEndDate,
    setDashboardDatePreset,
    setDashboardDateRange,
    resetDashboardFilters,
  } = useLeadStore();

  const [isOpen, setIsOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string>(dashboardDatePreset || 'this_month');
  const [customStart, setCustomStart] = useState<string>(dashboardStartDate || '');
  const [customEnd, setCustomEnd] = useState<string>(dashboardEndDate || '');
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Portaled popover ref — needed separately from dropdownRef because the popover no longer lives
  // inside dropdownRef's DOM subtree once portaled (see coords/createPortal below), so the
  // click-outside check needs to test both.
  const popoverRef = useRef<HTMLDivElement>(null);
  // Viewport-relative coordinates for the portaled, position:'fixed' panel — same technique as
  // LeadFilterPopover.tsx, needed because this dropdown lives inside .lead-hero-banner, which has
  // overflow:hidden (to clip its own decorative circles) and was clipping this 460px-wide popover
  // whenever it overflowed the banner's edge.
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    setActivePreset(dashboardDatePreset || 'this_month');
    setCustomStart(dashboardStartDate || '');
    setCustomEnd(dashboardEndDate || '');
  }, [dashboardDatePreset, dashboardStartDate, dashboardEndDate]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = dropdownRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Close popover when clicking outside — checks both the trigger buttons (dropdownRef) and the
  // portaled panel (popoverRef), since the panel is no longer a DOM descendant of dropdownRef.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentPresetLabel =
    PRESETS.find((p) => p.id === dashboardDatePreset)?.label ||
    (dashboardDatePreset === 'all' ? 'All Time' : 'This Month');

  const handleSelectPreset = (presetId: string) => {
    setActivePreset(presetId);
    if (presetId !== 'custom') {
      setDashboardDatePreset(presetId);
      setIsOpen(false);
    }
  };

  const handleApplyCustomRange = () => {
    if (customStart && customEnd) {
      setDashboardDateRange(customStart, customEnd);
      setActivePreset('custom');
      setIsOpen(false);
    }
  };

  return (
    <div className={styles.root} ref={dropdownRef}>
      {/* Main Filter Button - Matching Image */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={styles.trigger}
      >
        <Calendar size={16} className={styles.triggerIcon} />
        <span>{currentPresetLabel}</span>
        <ChevronDown size={15} className={`${styles.chevron}${isOpen ? ` ${styles.chevronOpen}` : ''}`} />
      </button>

      {/* Reset Button */}
      <button
        type="button"
        onClick={resetDashboardFilters}
        className={styles.resetBtn}
      >
        <RotateCcw size={14} />
        <span>Reset</span>
      </button>

      {/* Popover Card - Matching Attached Screenshot Exactly — portaled to document.body so it
          escapes .lead-hero-banner's overflow:hidden (there to clip the banner's own decorative
          circles), which otherwise clipped this 460px-wide popover whenever it overflowed the
          banner's edge. Position is computed from coords (see useLayoutEffect above) instead of a
          CSS position:absolute parent, same technique as LeadFilterPopover.tsx. */}
      {isOpen && coords && createPortal(
        <div
          ref={popoverRef}
          className={styles.panel}
          style={{ '--range-top': `${coords.top}px`, '--range-right': `${coords.right}px` } as React.CSSProperties}
        >
          {/* Left Column: Presets List */}
          <div className={styles.presets}>
            {PRESETS.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`${styles.preset}${isSelected ? ` ${styles.presetActive}` : ''}`}
                >
                  <span>{preset.label}</span>
                  {isSelected && <Check size={15} color="#2563eb" />}
                </button>
              );
            })}
          </div>

          {/* Right Column: Custom Range Inputs */}
          <div
            className={styles.custom}
          >
            <div>
              <div className={styles.customTitle}>
                Custom Range
              </div>

              <div className={styles.customField}>
                <label className={styles.customLabel}>
                  From
                </label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className={styles.dateInput}
                  />
              </div>

              <div className={styles.customFieldLast}>
                <label className={styles.customLabel}>
                  To
                </label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className={styles.dateInput}
                  />
              </div>
            </div>

            {/* Apply Button */}
            <button
              type="button"
              onClick={handleApplyCustomRange}
              disabled={!customStart || !customEnd}
              className={styles.applyBtn}
            >
              Apply
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
