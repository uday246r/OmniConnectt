import React, { useEffect, useMemo, useState } from 'react';
import { DetailField, DetailGrid, DetailSection, Drawer } from '@omniremit/ui';
import { LeadDiffTable } from '../../shared/LeadDiffTable';
import {
  Shield,
  ShieldCheck,
  Clock,
  User,
  Key,
  Globe,
  Layers,
  Activity,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Box,
  GitCommit,
  Copy,
  Check,
  LayoutGrid,
} from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import type { FieldDiff } from '../../types/lead';
import styles from './AuditDetailsDrawer.module.css';
import { Badge } from '@omniremit/ui';

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

/*
 * Normalises the IPv6 loopback forms to their IPv4 spelling — '::1' really is 127.0.0.1, so that
 * conversion states a fact. An ABSENT address is a different matter: this used to return
 * '127.0.0.1' for it, which asserts the action came from the server itself. It now returns an
 * empty string so the caller omits the field entirely.
 */
function formatIpv4(ip?: string | null): string {
  if (!ip) return '';
  try {
    let trimmed = String(ip).trim();
    if (trimmed === '::1' || trimmed === 'localhost') {
      return '127.0.0.1';
    }
    if (trimmed.startsWith('::ffff:')) {
      trimmed = trimmed.substring(7);
    }
    if (trimmed === '::') {
      return '127.0.0.1';
    }
    return trimmed;
  } catch {
    return '';
  }
}

function getActionLabel(action?: string): string {
  if (!action) return 'Unknown Action';
  const str = String(action);
  const lower = str.toLowerCase();
  switch (lower) {
    case 'create':
    case 'lead.created':
      return 'Lead Created';
    case 'edit':
    case 'update':
    case 'lead.updated':
      return 'Lead Updated';
    case 'delete':
    case 'lead.deleted':
      return 'Lead Deleted';
    case 'view':
    case 'lead.viewed':
      return 'Lead Viewed';
    default: {
      const segment = str.includes('.') ? str.slice(str.lastIndexOf('.') + 1) : str;
      return segment
        .replace(/_/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }
}

export const AuditDetailsDrawer: React.FC = () => {
  const { isAuditDetailsOpen, selectedAuditLog, closeAuditDetails } = useLeadStore();

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isAuditDetailsOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isAuditDetailsOpen]);

  // Parse diffs or previous/new JSON values if present
  const parsedDiffs = useMemo<FieldDiff[]>(() => {
    if (!selectedAuditLog) return [];

    try {
      // 1. If previousValues starts with JSON array
      if (
        typeof selectedAuditLog.previousValues === 'string' &&
        selectedAuditLog.previousValues.trim().startsWith('[')
      ) {
        const parsed = JSON.parse(selectedAuditLog.previousValues);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => ({
            field: String(item?.field || item?.key || item?.name || 'Field'),
            previousValue: String(item?.previousValue ?? item?.oldValue ?? item?.from ?? '—'),
            newValue: String(item?.newValue ?? item?.new ?? item?.to ?? '—'),
          }));
        }
      }

      // 2. If both previousValues and newValues exist as JSON objects
      if (
        typeof selectedAuditLog.previousValues === 'string' &&
        typeof selectedAuditLog.newValues === 'string' &&
        selectedAuditLog.previousValues.trim().startsWith('{') &&
        selectedAuditLog.newValues.trim().startsWith('{')
      ) {
        const prevObj = JSON.parse(selectedAuditLog.previousValues);
        const newObj = JSON.parse(selectedAuditLog.newValues);
        if (typeof prevObj === 'object' && typeof newObj === 'object' && prevObj && newObj) {
          const keys = Array.from(new Set([...Object.keys(prevObj), ...Object.keys(newObj)]));
          const diffs: FieldDiff[] = [];
          for (const key of keys) {
            if (prevObj[key] !== newObj[key]) {
              diffs.push({
                field: key,
                previousValue: prevObj[key] !== undefined ? String(prevObj[key]) : '—',
                newValue: newObj[key] !== undefined ? String(newObj[key]) : '—',
              });
            }
          }
          if (diffs.length > 0) return diffs;
        }
      }
    } catch {
      // ignore JSON parse error
    }

    return [];
  }, [selectedAuditLog]);

  if (!isAuditDetailsOpen || !selectedAuditLog) return null;

  const statusStr = selectedAuditLog.status ? String(selectedAuditLog.status) : '';
  const isSuccess = statusStr.toUpperCase() === 'SUCCESS' || !statusStr;
  const actorName = selectedAuditLog.userName || selectedAuditLog.userId || 'System';
  const actorInitial = (String(actorName).charAt(0) || 'S').toUpperCase();

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      closeAuditDetails();
    }
  };

  return (
    <Drawer
      open
      onClose={closeAuditDetails}
      closeLabel="Close details"
      title="Activity Details"
      subtitle="What happened, who did it, and when"
      icon={<Shield size={20} />}
    >
          {/* 1. Overview & Event Timeline (Two-Column Layout) */}
          <section className="audit-drawer-section">
            <div className="audit-overview-timeline-grid">
              {/* Left Column: Overview Subcards */}
              <div className="audit-overview-col">
                <h3 className="audit-drawer-section-title">
                  <LayoutGrid size={12} />
                  Summary
                </h3>
                <dl className="audit-detail-list">
                  {/* Service */}
                  <div className="audit-detail-row">
                    <span className="audit-detail-icon">
                      <Layers size={15} />
                    </span>
                    <div className="audit-detail-row-body">
                      <dt className="audit-detail-row-label">Application</dt>
                      <dd className="audit-detail-row-value">
                        <Badge tone="primary">
                          LeadService
                          </Badge>
                      </dd>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="audit-detail-row">
                    <span className="audit-detail-icon audit-detail-icon-neutral">
                      <Activity size={15} />
                    </span>
                    <div className="audit-detail-row-body">
                      <dt className="audit-detail-row-label">What Happened</dt>
                      <dd className="audit-detail-row-value">
                        <Badge tone="primary" className={styles.actionCode}>
                          {getActionLabel(selectedAuditLog.actionType)}
                          </Badge>
                      </dd>
                    </div>
                  </div>

                  {/* Result */}
                  <div className="audit-detail-row">
                    <span
                      className={`audit-detail-icon ${
                        isSuccess ? 'audit-detail-icon-success' : 'audit-detail-icon-danger'
                      }`}
                    >
                      {isSuccess ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    </span>
                    <div className="audit-detail-row-body">
                      <dt className="audit-detail-row-label">Outcome</dt>
                      <dd className="audit-detail-row-value">
                        <Badge tone={isSuccess ? 'success' : 'danger'} dot>
                          {isSuccess ? 'Success' : 'Failure'}
                        </Badge>
                      </dd>
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div className="audit-detail-row">
                    <span className="audit-detail-icon audit-detail-icon-purple">
                      <Clock size={15} />
                    </span>
                    <div className="audit-detail-row-body">
                      <dt className="audit-detail-row-label">Date &amp; Time</dt>
                      <dd className="audit-detail-row-value">
                        {formatTimestamp(selectedAuditLog.timestamp)}
                      </dd>
                    </div>
                  </div>
                </dl>
              </div>

              {/* Right Column: Event Timeline */}
              <div className="audit-overview-col audit-overview-col-divider">
                <h3 className="audit-drawer-section-title">
                  <Clock size={12} />
                  Timeline
                </h3>
                <div className="audit-timeline">
                  <div className="audit-timeline-step">
                    <span className="audit-timeline-dot" />
                    <div className="audit-timeline-step-card">
                      <span className="audit-timeline-label">
                        {selectedAuditLog.userName ? `Started by ${selectedAuditLog.userName}` : 'Activity recorded'}
                      </span>
                      <span className="audit-timeline-time">
                        <Clock size={12} />
                        {formatTimestamp(selectedAuditLog.timestamp)}
                      </span>
                    </div>
                  </div>

                  <div className="audit-timeline-step">
                    <span
                      className={`audit-timeline-dot ${
                        isSuccess ? 'audit-timeline-dot-success' : 'audit-timeline-dot-danger'
                      }`}
                    />
                    <div className="audit-timeline-step-card">
                      <span className="audit-timeline-label">
                        {isSuccess ? 'Finished successfully' : 'Did not complete'}
                      </span>
                      <span className="audit-timeline-time">
                        <ShieldCheck size={12} />
                        LeadService
                      </span>
                    </div>
                  </div>
                </div>

                {selectedAuditLog.reason && (
                  <div className="audit-reason-alert">
                    <AlertTriangle size={15} className={styles.warnIcon} />
                    <div>
                      <strong>Reason given:</strong> &ldquo;{selectedAuditLog.reason}&rdquo;
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/*
            Every field here is dropped when the backend sends nothing for it — DetailField returns
            null instead of rendering a placeholder. Previously "User Role" fell back to the invented
            value 'User', "Entity Type" to 'Lead', and the IP row printed an em dash; each of those
            told the reader something the audit record did not actually say.
          */}
          <DetailSection title="Who Did This" icon={<User size={12} />}>
            <DetailGrid>
              <DetailField label="Performed By" icon={<User size={15} />}>
                {selectedAuditLog.userName ? (
                  <span className="audit-user-chip">
                    <span className="audit-user-avatar">{actorInitial}</span>
                    <span>{selectedAuditLog.userName}</span>
                  </span>
                ) : null}
              </DetailField>

              <DetailField label="Role" icon={<Shield size={15} />}>
                {selectedAuditLog.userRole ? (
                  <Badge tone="primary">{selectedAuditLog.userRole}</Badge>
                ) : null}
              </DetailField>

              <DetailField label="IP Address" icon={<Globe size={15} />}>
                {selectedAuditLog.ipAddress ? (
                  <span className="audit-ip-badge">
                    <span className="audit-ip-dot" />
                    {formatIpv4(selectedAuditLog.ipAddress)}
                  </span>
                ) : null}
              </DetailField>
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Affected Record"
            icon={<Box size={12} />}
            hidden={!selectedAuditLog.entityType && !selectedAuditLog.description}
          >
            <DetailGrid>
              <DetailField label="Record Type" icon={<Layers size={15} />}>
                {selectedAuditLog.entityType ? (
                  <Badge tone="primary">{selectedAuditLog.entityType}</Badge>
                ) : null}
              </DetailField>

              <DetailField label="Description" icon={<FileText size={15} />} full>
                {selectedAuditLog.description}
              </DetailField>
            </DetailGrid>
          </DetailSection>

          {/* 4. What changed, field by field (if edit diffs exist) */}
          {parsedDiffs.length > 0 && (
            <section className="audit-drawer-section">
              <h3 className="audit-drawer-section-title">
                <GitCommit size={12} />
                What Changed
              </h3>
              <LeadDiffTable diffs={parsedDiffs} />
            </section>
          )}

      {/*
        The raw JSON payload dump, the "Copy JSON"/"Copy ID" controls, the truncated record GUID,
        and the footer close button were all removed: this drawer is read by business users
        reviewing who did what, and internal identifiers (or a redundant second close button, on
        top of the header's) are noise they cannot act on. Everything meaningful is already
        presented as labelled fields above — matches the host's own Activity Details drawer, which
        has no footer either.
      */}
    </Drawer>
  );
};
