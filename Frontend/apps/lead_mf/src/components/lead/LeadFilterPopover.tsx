import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@omniremit/ui';
import styles from './LeadFilterPopover.module.css';
import {
  Layers,
  Building2,
  Calendar,
  CreditCard,
  Phone,
  User,
  Flag,
  Search,
  X,
} from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import { FilterCriterion } from '../../types/lead';

interface LeadFilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** The Filter button's wrapping element. Positioning is computed from its live
   * getBoundingClientRect() rather than a CSS `position: absolute` parent, because the popover is
   * portaled to document.body to escape the table card's `overflow: hidden` (see ViewLeadPage.tsx's
   * "Main Table Container Card") — that ancestor clips the popover whenever the card's own height
   * collapses below the panel's ~400-480px floor height, which happens exactly when the filtered
   * list is empty. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

const TABS: { id: FilterCriterion; label: string; icon: React.ReactNode }[] = [
  { id: 'product', label: 'Product', icon: <Layers size={16} /> },
  { id: 'branch', label: 'Branch', icon: <Building2 size={16} /> },
  { id: 'createdFrom', label: 'Created From', icon: <Calendar size={16} /> },
  { id: 'createdTo', label: 'Created To', icon: <Calendar size={16} /> },
  { id: 'icNumber', label: 'IC Number', icon: <CreditCard size={16} /> },
  { id: 'phone', label: 'Phone Number', icon: <Phone size={16} /> },
  { id: 'name', label: 'Name', icon: <User size={16} /> },
  { id: 'status', label: 'Status', icon: <Flag size={16} /> },
];

// Fallback shown only for the brief window before the real product list has loaded from the API.
// This used to list 8 products, 5 of which don't exist in LeadService's product catalog at all
// (Backend/LeadService/Data/ApplicationDbContext.cs only seeds ASB Financing, Home Financing, and
// Micro Finance) — trimmed to match what the backend actually has.
const DEFAULT_PRODUCTS = [
  'Home Financing',
  'ASB Financing',
  'Micro Finance',
];

const STATUSES = ['New', 'Contacted', 'In Progress', 'Qualified', 'Converted', 'Closed'];

export const LeadFilterPopover: React.FC<LeadFilterPopoverProps> = ({ isOpen, onClose, anchorRef }) => {
  const {
    products,
    branches,
    filterRules,
    updateFilterRule,
    removeFilterRule,
    clearAllFilters,
    fetchLeads,
  } = useLeadStore();

  const [activeTab, setActiveTab] = useState<FilterCriterion>('product');
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  // Viewport-relative coordinates for the portaled, position:'fixed' panel. Recomputed synchronously
  // before paint whenever it opens (and on resize/scroll while open) so it always tracks the button
  // it's anchored to, exactly like the old position:'absolute' layout did — just computed by hand
  // instead of by the CSS box model, since a portal has no positioned ancestor to be absolute to.
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
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
  }, [isOpen, anchorRef]);

  /*
   * Close when clicking outside. popoverRef.current.contains(e.target) is unaffected by the portal —
   * it checks real DOM containment, which doesn't care where in the tree the node was mounted.
   *
   * The ANCHOR must be excluded, not just the popover. The trigger's own handler is
   * `setShowFilters(!showFilters)`, and mousedown fires before click: pressing the trigger while
   * the popover was open ran onClose() first (state -> false), then the trigger's click toggled it
   * straight back to true. The popover shut and immediately reopened, so it could not be dismissed
   * from its own button. Treating the anchor as "inside" lets the trigger toggle do its job.
   */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insidePopover = popoverRef.current?.contains(target);
      const insideAnchor = anchorRef.current?.contains(target);
      if (!insidePopover && !insideAnchor) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorRef]);

  // Escape closes it too. Nothing here handled the keyboard at all.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !coords) return null;

  // Helper to get rule value by field
  const getRuleValue = (field: FilterCriterion): string => {
    const rule = filterRules.find((r) => r.field === field);
    return rule ? rule.value : '';
  };

  // Helper to set rule value by field
  const setRuleValue = (field: FilterCriterion, value: string) => {
    const existingRule = filterRules.find((r) => r.field === field);
    if (!value || !value.trim()) {
      if (existingRule) {
        removeFilterRule(existingRule.id);
      }
    } else {
      if (existingRule) {
        updateFilterRule(existingRule.id, field, value);
      } else {
        const id = `rule-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        useLeadStore.setState((state) => ({
          filterRules: [...state.filterRules, { id, field, value }],
        }));
      }
    }
  };

  // Toggle value in comma-separated list
  const toggleMultiValue = (field: FilterCriterion, optionVal: string) => {
    const currentStr = getRuleValue(field);
    let list = currentStr ? currentStr.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (list.includes(optionVal)) {
      list = list.filter((item) => item !== optionVal);
    } else {
      list.push(optionVal);
    }
    setRuleValue(field, list.join(','));
  };

  const handleSearchChange = (field: string, val: string) => {
    setSearchQueries((prev) => ({ ...prev, [field]: val }));
  };

  const currentSearch = searchQueries[activeTab] || '';

  // Get master product list
  const allProducts = products.length > 0 ? products.map((p) => p.label) : DEFAULT_PRODUCTS;
  const filteredProducts = allProducts.filter((p) => p.toLowerCase().includes(currentSearch.toLowerCase()));

  // Get master branch list
  const allBranches = branches.map((b) => b.label);
  const filteredBranches = allBranches.filter((b) => b.toLowerCase().includes(currentSearch.toLowerCase()));

  // Get statuses
  const filteredStatuses = STATUSES.filter((s) => s.toLowerCase().includes(currentSearch.toLowerCase()));

  const handleReset = () => {
    clearAllFilters();
    setSearchQueries({});
    fetchLeads();
    onClose();
  };

  /** Every criterion that currently carries a value, in the rail's own order. */
  const activeChips = TABS.map((tab) => ({
    field: tab.id,
    label: tab.label,
    value: getRuleValue(tab.id),
  })).filter((c) => c.value.trim().length > 0);

  /** Drop one criterion and refetch, leaving the others alone. */
  const handleRemoveFilter = (field: FilterCriterion) => {
    setRuleValue(field, '');
    setSearchQueries((prev) => ({ ...prev, [field]: '' }));
    fetchLeads();
  };

  const handleApply = () => {
    fetchLeads();
    onClose();
  };

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      /* Anchor offsets are computed from the trigger's position, so they arrive as custom
         properties; the declarations live in LeadFilterPopover.module.css. */
      style={
        {
          '--lead-filter-top': `${coords.top}px`,
          '--lead-filter-right': `${coords.right}px`,
        } as React.CSSProperties
      }
    >
      {/* Arrow Indicator */}
      <div className={styles.arrow}
      />

      {/*
        * Active filters, each individually removable.
        *
        * Previously the ONLY way to drop a filter was Reset, which cleared every one of them — so
        * narrowing by Product and Branch and then wanting just Product back meant re-entering both.
        * The host shows an active filter per column and a per-column Reset; this is the equivalent
        * for a popover that edits several criteria at once.
        */}
      {activeChips.length > 0 && (
        <div className={styles.activeBar}>
          <span className={styles.activeBarLabel}>Active</span>
          <div className={styles.activeChips}>
            {activeChips.map((chip) => (
              <span key={chip.field} className={styles.chip}>
                <span className={styles.chipField}>{chip.label}</span>
                <span className={styles.chipValue} title={chip.value}>{chip.value}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => handleRemoveFilter(chip.field)}
                  aria-label={`Remove ${chip.label} filter`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Split View */}
      <div className={styles.split}>
        {/* Left Column — Subcategory Tabs */}
        <div className={styles.tabList}>
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            const hasRule = !!getRuleValue(tab.id);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`${styles.tab}${isSelected ? ` ${styles.tabActive}` : ''}`}
              >
                <span className={styles.tabIcon}>
                  {tab.icon}
                </span>
                <span className={styles.tabLabel}>{tab.label}</span>
                {hasRule && (
                  <span className={styles.tabDot} />
                )}
              </button>
            );
          })}
        </div>

        {/* Right Column — Tab Specific Input Options */}
        <div className={styles.panel}>
          <div className={styles.panelTitle}>
            {TABS.find((t) => t.id === activeTab)?.label}
          </div>

          {/* Tab 1: Product */}
          {activeTab === 'product' && (
            <div className={styles.field}>
              {/* Search Bar */}
              <div className={styles.searchWrap}>
                <Search size={15} className={styles.searchIcon} />
                <input
                  type="text"
                  placeholder="Search product..."
                  value={currentSearch}
                  onChange={(e) => handleSearchChange('product', e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              {/* Checkbox Options — NO numbers rendered as requested */}
              <div className={styles.optionList}>
                {filteredProducts.map((p) => {
                  const selectedList = getRuleValue('product').split(',').map((s) => s.trim());
                  const checked = selectedList.includes(p);

                  return (
                    <label
                      key={p}
                      className={`${styles.option}${checked ? ` ${styles.optionChecked}` : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMultiValue('product', p)}
                        className={styles.optionBox}
                      />
                      <span>{p}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: Branch */}
          {activeTab === 'branch' && (
            <div className={styles.field}>
              <div className={styles.searchWrap}>
                <Search size={15} className={styles.searchIcon} />
                <input
                  type="text"
                  placeholder="Search branch..."
                  value={currentSearch}
                  onChange={(e) => handleSearchChange('branch', e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.optionList}>
                {filteredBranches.length > 0 ? (
                  filteredBranches.map((b) => {
                    const selectedList = getRuleValue('branch').split(',').map((s) => s.trim());
                    const checked = selectedList.includes(b);

                    return (
                      <label
                        key={b}
                        className={`${styles.option}${checked ? ` ${styles.optionChecked}` : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMultiValue('branch', b)}
                          className={styles.optionBox}
                        />
                        <span>{b}</span>
                      </label>
                    );
                  })
                ) : (
                  <div className={styles.noResults}>
                    No branches found.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: Created From */}
          {activeTab === 'createdFrom' && (
            <div className={styles.textField}>
              <label className={styles.fieldLabel}>
                Select Start Creation Date
              </label>
              <input
                type="date"
                value={getRuleValue('createdFrom')}
                onChange={(e) => setRuleValue('createdFrom', e.target.value)}
                className={styles.textInput}
              />
            </div>
          )}

          {/* Tab 5: Created To */}
          {activeTab === 'createdTo' && (
            <div className={styles.textField}>
              <label className={styles.fieldLabel}>
                Select End Creation Date
              </label>
              <input
                type="date"
                value={getRuleValue('createdTo')}
                onChange={(e) => setRuleValue('createdTo', e.target.value)}
                className={styles.textInput}
              />
            </div>
          )}

          {/* Tab 6: IC Number */}
          {activeTab === 'icNumber' && (
            <div className={styles.textField}>
              <label className={styles.fieldLabel}>
                Search IC Number
              </label>
              <input
                type="text"
                placeholder="Enter IC Number (e.g. 123456-98-7890)"
                value={getRuleValue('icNumber')}
                onChange={(e) => setRuleValue('icNumber', e.target.value)}
                className={styles.textInput}
              />
            </div>
          )}

          {/* Tab 7: Phone Number */}
          {activeTab === 'phone' && (
            <div className={styles.textField}>
              <label className={styles.fieldLabel}>
                Search Phone Number
              </label>
              <input
                type="text"
                placeholder="Enter Phone Number (e.g. 897657863)"
                value={getRuleValue('phone')}
                onChange={(e) => setRuleValue('phone', e.target.value)}
                className={styles.textInput}
              />
            </div>
          )}

          {/* Tab 8: Name */}
          {activeTab === 'name' && (
            <div className={styles.textField}>
              <label className={styles.fieldLabel}>
                Search Customer Name
              </label>
              <input
                type="text"
                placeholder="Enter Customer Name..."
                value={getRuleValue('name')}
                onChange={(e) => setRuleValue('name', e.target.value)}
                className={styles.textInput}
              />
            </div>
          )}

          {/* Tab 9: Status */}
          {activeTab === 'status' && (
            <div className={styles.field}>
              <div className={styles.searchWrap}>
                <Search size={15} className={styles.searchIcon} />
                <input
                  type="text"
                  placeholder="Search status..."
                  value={currentSearch}
                  onChange={(e) => handleSearchChange('status', e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.optionList}>
                {filteredStatuses.map((st) => {
                  const selectedList = getRuleValue('status').split(',').map((item) => item.trim());
                  const checked = selectedList.includes(st);

                  return (
                    <label
                      key={st}
                      className={`${styles.option}${checked ? ` ${styles.optionChecked}` : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMultiValue('status', st)}
                        className={styles.optionBox}
                      />
                      <span>{st}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div
        className={styles.footer}
      >
        {/* Was drawer-btn-cancel shrunk inline to 36px/13px — which is the shared Button's `sm`
            size, so it now uses that rather than a per-call-site override. */}
        <Button type="button" size="sm" variant="secondary" onClick={handleReset}>
          Reset
        </Button>
        <Button type="button" size="sm" onClick={handleApply}>
          Apply Filters
        </Button>
      </div>
    </div>,
    document.body,
  );
};
