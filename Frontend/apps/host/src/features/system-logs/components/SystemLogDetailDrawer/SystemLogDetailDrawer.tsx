import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  DetailField,
  DetailGrid,
  DetailSection,
  DetailSections,
  Drawer,
  formatAuditTimestamp,
} from '@omniconnect/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import type { SystemLogDto } from '../../api/systemLogsApi'
import {
  describeStatusCode,
  environmentTone,
  formatEventCode,
  formatServiceName,
  severityTone,
  statusCodeTone,
} from '../../utils/systemLogFormatting'
import styles from './SystemLogDetailDrawer.module.css'

interface SystemLogDetailDrawerProps {
  log: SystemLogDto | null
  onClose: () => void
  onViewRelated?: (correlationId: string) => void
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** How long a copy button shows its confirmation before returning to the copy glyph. */
const COPIED_FEEDBACK_MS = 1500

/**
 * One system log, explained for the person reading it first and the engineer second.
 *
 * The drawer used to open on event codes, request, correlation, tenant and user GUIDs — useful to
 * someone grepping a log store, noise to an operator asking "what went wrong?". The top now says what
 * happened in words (message, severity, service, module, when, the HTTP outcome described). Every raw
 * identifier, the stack trace and the metadata sit in one collapsed "Technical details" section, each
 * copyable, so nothing an engineer needs is lost.
 */
export function SystemLogDetailDrawer({ log, onClose, onViewRelated }: SystemLogDetailDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  if (!log) return null

  const tone = severityTone(log.severity)
  const statusText = describeStatusCode(log.statusCode)

  const copy = (text: string, field: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedField(field)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopiedField(null), COPIED_FEEDBACK_MS)
  }

  const copyButton = (text: string, field: string, label: string) => (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={() => copy(text, field)}
      aria-label={copiedField === field ? `${label} copied` : `Copy ${label}`}
      title={copiedField === field ? 'Copied' : `Copy ${label}`}
    >
      {copiedField === field ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
    </button>
  )

  const identifier = (value: string | null, field: string, label: string) =>
    value ? (
      <span className={styles.idValue}>
        <span className={styles.monoValue}>{value}</span>
        {copyButton(value, field, label)}
      </span>
    ) : null

  return (
    <Drawer
      open
      onClose={onClose}
      closeLabel="Close details"
      title="System Log Details"
      subtitle={formatEventCode(log.eventCode)}
      icon={
        tone === 'danger' ? <Icon.AlertCircle width={20} height={20} />
          : tone === 'warning' ? <Icon.AlertTriangle width={20} height={20} />
            : <Icon.Info width={20} height={20} />
      }
    >
      <DetailSections>
        <DetailSection title="What Happened" icon={<Icon.FileText width={12} height={12} />}>
          <div className={styles.messageHeader}>
            <p className={styles.messageBox}>{log.message}</p>
            {copyButton(log.message, 'message', 'message')}
          </div>
          <DetailGrid>
            <DetailField label="Severity"><Badge tone={tone}>{log.severity}</Badge></DetailField>
            <DetailField label="Event" icon={<Icon.Activity width={15} height={15} />}>{formatEventCode(log.eventCode)}</DetailField>
            <DetailField label="Service" icon={<Icon.Layers width={15} height={15} />}>{formatServiceName(log.serviceName)}</DetailField>
            <DetailField label="Module" icon={<Icon.Box width={15} height={15} />}>{log.module}</DetailField>
            <DetailField label="When" icon={<Icon.Clock width={15} height={15} />}>{formatAuditTimestamp(log.occurredAt)}</DetailField>
            <DetailField label="Environment" icon={<Icon.Globe width={15} height={15} />}>
              {log.environment ? <Badge tone={environmentTone(log.environment)}>{log.environment}</Badge> : null}
            </DetailField>
            <DetailField label="Request Outcome">
              {statusText && log.statusCode !== null ? <Badge tone={statusCodeTone(log.statusCode)}>{statusText}</Badge> : null}
            </DetailField>
            <DetailField label="Triggered By">{log.userId ? 'A signed-in user' : 'The system'}</DetailField>
          </DetailGrid>
        </DetailSection>

        {onViewRelated && log.correlationId && (
          <DetailSection title="Related Activity" icon={<Icon.Link width={12} height={12} />}>
            <p className={styles.relatedHint}>Every log written while handling the same request.</p>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Link width={14} height={14} />}
              onClick={() => {
                onViewRelated(log.correlationId)
                onClose()
              }}
            >
              View Related Logs
            </Button>
          </DetailSection>
        )}

        {/* Collapsed by default: identifiers mean nothing until someone needs to search another system for them. */}
        <details className={styles.technical}>
          <summary className={styles.technicalSummary}>
            <Icon.Settings width={13} height={13} />
            Technical details
          </summary>
          <div className={styles.technicalBody}>
            <DetailGrid>
              <DetailField label="Event Code" full>{identifier(log.eventCode, 'eventCode', 'event code')}</DetailField>
              <DetailField label="Request ID" full>{identifier(log.requestId, 'requestId', 'request ID')}</DetailField>
              <DetailField label="Correlation ID" full>{identifier(log.correlationId, 'correlationId', 'correlation ID')}</DetailField>
              <DetailField label="Tenant ID" full>{identifier(log.tenantId, 'tenantId', 'tenant ID')}</DetailField>
              <DetailField label="User ID" full>{identifier(log.userId, 'userId', 'user ID')}</DetailField>
              <DetailField label="Service Name" full>{identifier(log.serviceName, 'serviceName', 'service name')}</DetailField>
            </DetailGrid>

            {log.stackTrace && (
              <div className={styles.codeBlock}>
                <div className={styles.codeBlockHeader}>
                  <span>Sanitized stack trace</span>
                  {copyButton(log.stackTrace, 'stackTrace', 'stack trace')}
                </div>
                <pre className={styles.stackTraceBox}>{log.stackTrace}</pre>
              </div>
            )}

            {log.metadata && (
              <div className={styles.codeBlock}>
                <div className={styles.codeBlockHeader}>
                  <span>Metadata</span>
                  {copyButton(log.metadata, 'metadata', 'metadata')}
                </div>
                <pre className={styles.metadataBox}>{tryPrettyJson(log.metadata)}</pre>
              </div>
            )}
          </div>
        </details>
      </DetailSections>
    </Drawer>
  )
}
