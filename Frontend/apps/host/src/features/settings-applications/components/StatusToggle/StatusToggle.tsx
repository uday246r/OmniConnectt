import { useState } from 'react'
import type { RemoteAppDto, RemoteAppStatus } from '../../api/remoteAppsApi'
import styles from './StatusToggle.module.css'
import { Badge, Button, Modal, type BadgeTone } from '@omniremit/ui'

const STATUS_TONE: Record<RemoteAppStatus, BadgeTone> = {
  Active: 'success',
  Maintenance: 'warning',
  Disabled: 'neutral',
}

const OPTIONS: { value: RemoteAppStatus; title: string; hint: string }[] = [
  { value: 'Active', title: 'Active', hint: 'Visible in the sidebar and loads normally.' },
  { value: 'Maintenance', title: 'Maintenance', hint: "Stays in the sidebar, shows your message instead of loading." },
  { value: 'Disabled', title: 'Disabled', hint: "Hidden from the sidebar and unreachable by direct link." },
]

export interface StatusToggleProps {
  app: RemoteAppDto
  disabled?: boolean
  onSave: (status: RemoteAppStatus, maintenanceMessage: string | null) => Promise<void>
}

export function StatusToggle({ app, disabled, onSave }: StatusToggleProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RemoteAppStatus>(app.status)
  const [message, setMessage] = useState(app.maintenanceMessage ?? '')
  const [saving, setSaving] = useState(false)

  function openModal() {
    setStatus(app.status)
    setMessage(app.maintenanceMessage ?? '')
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(status, status === 'Maintenance' ? message : null)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" className={styles.trigger} onClick={openModal} disabled={disabled}>
        <Badge tone={STATUS_TONE[app.status]} dot>
          {app.status}
        </Badge>
      </button>

      <Modal
        open={open}
        title={`Status for ${app.displayName}`}
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className={styles.optionList}>
          {OPTIONS.map((option) => (
            <label className={styles.option} key={option.value}>
              <input
                type="radio"
                name="remote-app-status"
                value={option.value}
                checked={status === option.value}
                onChange={() => setStatus(option.value)}
              />
              <span className={styles.optionCopy}>
                <span className={styles.optionTitle}>{option.title}</span>
                <span className={styles.optionHint}>{option.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {status === 'Maintenance' && (
          <div className={styles.messageField}>
            <label htmlFor="maintenance-message">Message shown to users</label>
            <textarea
              id="maintenance-message"
              className={styles.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="This app is temporarily unavailable. Please check back shortly."
            />
          </div>
        )}
      </Modal>
    </>
  )
}
