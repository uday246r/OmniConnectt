import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Tabs.module.css'

export interface TabItem {
  key: string
  label: string
  /** Optional trailing marker, e.g. a count badge — kept generic so callers don't need a variant per use case. */
  suffix?: ReactNode
}

export interface TabsProps {
  tabs: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  /** Identifies the tab group for aria-controls/aria-labelledby pairing with the panel(s) the caller renders separately. */
  id: string
}

/**
 * Accessible tab list — role="tablist"/"tab" with roving tabindex and full keyboard navigation
 * (Left/Right/Home/End), matching the WAI-ARIA tabs pattern. Renders only the tab strip; the caller
 * owns the tabpanel content (typically one `role="tabpanel"` div per tab, only the active one shown)
 * so this component stays reusable across pages with very different panel layouts.
 */
export function Tabs({ tabs, activeKey, onChange, id }: TabsProps) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  function focusAndSelect(key: string) {
    onChange(key)
    tabRefs.current.get(key)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault()
        const next = tabs[(index + 1) % tabs.length]
        focusAndSelect(next.key)
        break
      }
      case 'ArrowLeft': {
        event.preventDefault()
        const prev = tabs[(index - 1 + tabs.length) % tabs.length]
        focusAndSelect(prev.key)
        break
      }
      case 'Home': {
        event.preventDefault()
        focusAndSelect(tabs[0].key)
        break
      }
      case 'End': {
        event.preventDefault()
        focusAndSelect(tabs[tabs.length - 1].key)
        break
      }
    }
  }

  return (
    <div className={styles.tablist} role="tablist" aria-orientation="horizontal" id={id}>
      {tabs.map((tab, index) => {
        const isActive = tab.key === activeKey
        return (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.key, el)
              else tabRefs.current.delete(tab.key)
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            className={classNames(styles.tab, isActive && styles.tabActive)}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {tab.label}
            {tab.suffix}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  id: string
  tabId: string
  active: boolean
  children: ReactNode
}

/** Pairs with Tabs — one per tab, only the active one is rendered to the DOM. */
export function TabPanel({ id, tabId, active, children }: TabPanelProps) {
  if (!active) return null
  return (
    <div role="tabpanel" id={`${id}-panel-${tabId}`} aria-labelledby={`${id}-tab-${tabId}`} tabIndex={0} className={styles.panel}>
      {children}
    </div>
  )
}
