import React, { useEffect, useMemo, useState } from 'react';
import { Button, Drawer } from '@omniremit/ui';
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
} from 'lucide-react';
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

function formatIpv4(ip?: string | null): string {
  if (!ip) return '127.0.0.1';
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
    return trimmed || '127.0.0.1';
  } catch {
    return '127.0.0.1';
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
      closeLabel="Close details drawer"
      title="Audit Record Details"
      subtitle="Full event context, actor, and execution metadata"
      icon={<Shield size={22} />}
      footer={
        <Button type="button" variant="secondary" onClick={closeAuditDetails}>
          Close Details
        </Button>
      }
    >
          {/* 1. Overview & Event Timeline (Two-Column Layout) */}
          <section className="audit-drawer-section">
            <div className="audit-overview-timeline-grid">
              {/* Left Column: Overview Subcards */}
              <div className="audit-overview-col">
                <h3 className="audit-drawer-section-title">
                  <LayoutGrid size={12} />
                  Overview
                </h3>
                <dl className="audit-detail-list">
                  {/* Service */}
                  <div className="audit-detail-row">
                    <span className="audit-detail-icon">
                      <Layers size={15} />
                    </span>
                    <div className="audit-detail-row-body">
                      <dt className="audit-detail-row-label">Service</dt>
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
                      <dt className="audit-detail-row-label">Action</dt>
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
                      <dt className="audit-detail-row-label">Result</dt>
                      <dd className="audit-detail-row-value">
                        <Badge tone={isSuccess ? 'success' : 'danger'} dot>
                          {isSuccess ? 'Success' : selectedAuditLog.status || 'Failed'}
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
                      <dt className="audit-detail-row-label">Timestamp</dt>
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
                  Event Timeline
                </h3>
                <div className="audit-timeline">
                  <div className="audit-timeline-step">
                    <span className="audit-timeline-dot" />
                    <div className="audit-timeline-step-card">
                      <span className="audit-timeline-label">
                        Triggered by {selectedAuditLog.userName || 'System'}
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
                        {isSuccess ? 'Event Completed Successfully' : 'Event Execution Failed'}
                      </span>
                      <span className="audit-timeline-time">
                        <ShieldCheck size={12} />
                        Lead Management
                      </span>
                    </div>
                  </div>
                </div>

                {selectedAuditLog.reason && (
                  <div className="audit-reason-alert">
                    <AlertTriangle size={15} className={styles.warnIcon} />
                    <div>
                      <strong>Audit Reason:</strong> &ldquo;{selectedAuditLog.reason}&rdquo;
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 2. Actor & Authentication Context */}
          <section className="audit-drawer-section">
            <h3 className="audit-drawer-section-title">
              <User size={12} />
              Actor &amp; Authentication Context
            </h3>
            <div className="audit-field-card-grid">
              <div className="audit-field-card">
                <span className="audit-field-card-icon">
                  <User size={15} />
                </span>
                <div className="audit-field-card-body">
                  <span className="audit-field-card-label">Actor Name</span>
                  <div className="audit-field-card-value">
                    <div className="audit-user-chip">
                      <span className="audit-user-avatar">{actorInitial}</span>
                      <span>{selectedAuditLog.userName || 'System'}</span>
                    </div>
                  </div>
                </div>
              </div>


              <div className="audit-field-card">
                <span className="audit-field-card-icon">
                  <Shield size={15} />
                </span>
                <div className="audit-field-card-body">
                  <span className="audit-field-card-label">User Role</span>
                  <span className="audit-field-card-value">
                    <Badge tone="primary">
                      {selectedAuditLog.userRole || 'User'}
                      </Badge>
                  </span>
                </div>
              </div>

              <div className="audit-field-card">
                <span className="audit-field-card-icon">
                  <Globe size={15} />
                </span>
                <div className="audit-field-card-body">
                  <span className="audit-field-card-label">Client IP (IPv4)</span>
                  <span className="audit-field-card-value">
                    <span className="audit-ip-badge">
                      <span className="audit-ip-dot" />
                      {formatIpv4(selectedAuditLog.ipAddress)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Target Entity Context */}
          <section className="audit-drawer-section">
            <h3 className="audit-drawer-section-title">
              <Box size={12} />
              Target Entity Context
            </h3>
            <div className="audit-field-card-grid">
              <div className="audit-field-card">
                <span className="audit-field-card-icon">
                  <Layers size={15} />
                </span>
                <div className="audit-field-card-body">
                  <span className="audit-field-card-label">Entity Type</span>
                  <span className="audit-field-card-value">
                    <Badge tone="primary">
                      {selectedAuditLog.entityType || 'Lead'}
                      </Badge>
                  </span>
                </div>
              </div>


              <div className="audit-field-card audit-field-card-full">
                <span className="audit-field-card-icon">
                  <FileText size={15} />
                </span>
                <div className="audit-field-card-body">
                  <span className="audit-field-card-label">Event Description</span>
                  <span className="audit-field-card-value">
                    {selectedAuditLog.description || 'No description provided.'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 4. Field-Level Modification Diffs (if edit diffs exist) */}
          {parsedDiffs.length > 0 && (
            <section className="audit-drawer-section">
              <h3 className="audit-drawer-section-title">
                <GitCommit size={12} />
                Field-Level Modification Diffs
              </h3>
              <LeadDiffTable diffs={parsedDiffs} />
            </section>
          )}

      {/*
        The footer's raw JSON payload dump, the "Copy JSON"/"Copy ID" controls and the truncated
        record GUID were removed: this drawer is read by business users reviewing who did what, and
        internal identifiers are noise they cannot act on. Everything meaningful is already
        presented as labelled fields above. What remains is passed to the Drawer's `footer` slot.
      */}
    </Drawer>
  );
};
