import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, Check, RotateCcw } from 'lucide-react';
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
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '10px' }} ref={dropdownRef}>
      {/* Main Filter Button - Matching Image */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          background: '#ffffff',
          border: '1.5px solid #3b82f6',
          borderRadius: '10px',
          fontSize: '13.5px',
          fontWeight: 600,
          color: '#0f172a',
          boxShadow: '0 2px 6px rgba(59, 130, 246, 0.12)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <Calendar size={16} color="#2563eb" />
        <span>{currentPresetLabel}</span>
        <ChevronDown size={15} color="#64748b" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
      </button>

      {/* Reset Button */}
      <button
        type="button"
        onClick={resetDashboardFilters}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 14px',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
          fontSize: '13px',
          fontWeight: 600,
          color: '#2563eb',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          transition: 'all 0.15s ease',
        }}
      >
        <RotateCcw size={14} color="#2563eb" />
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
          style={{
            position: 'fixed',
            top: coords.top,
            right: coords.right,
            zIndex: 1200,
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 12px 32px -4px rgba(15, 23, 42, 0.15), 0 4px 12px rgba(0,0,0,0.06)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            width: '460px',
            overflow: 'hidden',
            padding: '12px',
            gap: '16px',
          }}
        >
          {/* Left Column: Presets List */}
          <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {PRESETS.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isSelected ? '#eff6ff' : 'transparent',
                    color: isSelected ? '#2563eb' : '#334155',
                    fontWeight: isSelected ? 600 : 500,
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <span>{preset.label}</span>
                  {isSelected && <Check size={15} color="#2563eb" />}
                </button>
              );
            })}
          </div>

          {/* Right Column: Custom Range Inputs */}
          <div
            style={{
              width: '210px',
              borderLeft: '1px solid #f1f5f9',
              paddingLeft: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', marginBottom: '14px' }}>
                Custom Range
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 500 }}>
                  From
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12.5px',
                      color: '#0f172a',
                      fontWeight: 500,
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: '#f8fafc',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 500 }}>
                  To
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12.5px',
                      color: '#0f172a',
                      fontWeight: 500,
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: '#f8fafc',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Apply Button */}
            <button
              type="button"
              onClick={handleApplyCustomRange}
              disabled={!customStart || !customEnd}
              style={{
                width: '100%',
                padding: '9px 16px',
                background: !customStart || !customEnd ? '#94a3b8' : '#2563eb',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: !customStart || !customEnd ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                transition: 'background-color 0.15s ease',
              }}
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
