import React, { useState } from 'react';
import { useInteractionStore } from '../store/interactionStore';
import { FileText, User, ShieldAlert, Check, Copy, Hash, Calendar, Layers, Activity } from '@omniremit/ui/icons';
import { Button, Badge, DetailField, DetailGrid, DetailSection, Drawer, EMPTY_VALUE } from '@omniremit/ui';
import { formatValue } from '../shared/formatValue';
import styles from './ProductDetailsModal.module.css';

export default function CaseDetailsModal() {
  const { selectedCase, modalOpen, closeCaseModal } = useInteractionStore();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (modalOpen && selectedCase) {
      const caseIdStr = String(selectedCase.caseId || '').trim();
      window.dispatchEvent(
        new CustomEvent('omni:track-activity', {
          detail: {
            page: 'individual',
            module: 'Customer 360',
            sourceApplication: 'Customer 360',
            pageLabel: 'Individual',
            action: 'case.details_viewed',
            actionCategory: 'ViewDetails',
            entityType: 'Case',
            entityId: caseIdStr,
            entityLabel: selectedCase.main || `Case #${caseIdStr}`,
            details: `Viewed details for case #${caseIdStr} (${selectedCase.main || 'Interaction'})`,
          },
        })
      );
    }
  }, [modalOpen, selectedCase]);

  if (!modalOpen || !selectedCase) return null;

  const handleCopyText = (key: string, text?: string | null) => {
    if (!text || text === EMPTY_VALUE) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const caseIdStr = String(selectedCase.caseId || '').trim();
  const title = selectedCase.main || 'Interaction Case';
  const subtitle = `${selectedCase.subCategory1 || 'Customer Service'}${caseIdStr ? ` • Case #${caseIdStr}` : ''}`;

  return (
    <Drawer
      open={modalOpen}
      onClose={closeCaseModal}
      closeLabel="Close case details"
      title={title}
      subtitle={subtitle}
      icon={<FileText size={20} />}
      footer={
        <div className={styles.footerSpread}>
          <div className={styles.footerMeta}>
            <span className={styles.footerAccountId}>
              Case: {caseIdStr || EMPTY_VALUE}
            </span>
            {caseIdStr && (
              <button
                type="button"
                onClick={() => handleCopyText('caseId', caseIdStr)}
                className={`${styles.footerCopyBtn}${copiedKey === 'caseId' ? ` ${styles.footerCopyBtnCopied}` : ''}`}
                title="Copy Case ID"
              >
                {copiedKey === 'caseId' ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedKey === 'caseId' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={closeCaseModal}>
            Close Details
          </Button>
        </div>
      }
    >
      <div>
        {/* Hero Identity Overview Card */}
        <div className={styles.heroCard}>
          <div className={styles.heroLeft}>
            <div className={`${styles.heroAvatar} ${styles.heroAvatarPurple}`}>
              <Activity size={24} />
            </div>
            <div className={styles.heroMeta}>
              <h3 className={styles.heroTitle}>{title}</h3>
              <div className={styles.heroTags}>
                <Badge tone="primary">{selectedCase.subCategory1 || 'Support Case'}</Badge>
                {selectedCase.subCategory2 && <Badge tone="neutral">{selectedCase.subCategory2}</Badge>}
                {caseIdStr && (
                  <span className={styles.accountPill}>
                    <Hash size={11} />
                    {caseIdStr}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick 3-Metric KPI Highlights Strip */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTilePrimary}`}>
              <Layers size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Service</span>
              <span className={`${styles.kpiValue} ${styles.kpiValuePrimary}`}>
                {formatValue(selectedCase.main)}
              </span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTileAmber}`}>
              <Calendar size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Date Logged</span>
              <span className={styles.kpiValue}>
                {formatValue(selectedCase.dateCase)}
              </span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTileSuccess}`}>
              <ShieldAlert size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Amount Involved</span>
              <span className={`${styles.kpiValue} ${styles.kpiValueSuccess}`}>
                {formatValue(selectedCase.amountInvolved)}
              </span>
            </div>
          </div>
        </div>

        {/* Section 1: Case Overview */}
        <DetailSection title="Case Overview & Classification" icon={<FileText size={13} />}>
          <DetailGrid>
            <DetailField label="Service Category">{formatValue(selectedCase.main)}</DetailField>
            <DetailField label="Sub Category 1">{formatValue(selectedCase.subCategory1)}</DetailField>
            <DetailField label="Sub Category 2">{formatValue(selectedCase.subCategory2)}</DetailField>
            <DetailField label="Date Logged">{formatValue(selectedCase.dateCase)}</DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Section 2: Contact & Identity */}
        <DetailSection title="Contact & Customer Identity" icon={<User size={13} />}>
          <DetailGrid>
            <DetailField label="Contact Number" mono>
              {selectedCase.contactNo && (
                <span className={styles.fieldValueRow}>
                  <span>{formatValue(selectedCase.contactNo)}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('contactNo', selectedCase.contactNo)}
                    className={`${styles.copyBtn}${copiedKey === 'contactNo' ? ` ${styles.copyBtnCopied}` : ''}`}
                    title="Copy Contact Number"
                  >
                    {copiedKey === 'contactNo' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
              )}
            </DetailField>

            <DetailField label="National ID / IC" mono>
              {selectedCase.nric && (
                <span className={styles.fieldValueRow}>
                  <span>{formatValue(selectedCase.nric)}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('nric', selectedCase.nric)}
                    className={`${styles.copyBtn}${copiedKey === 'nric' ? ` ${styles.copyBtnCopied}` : ''}`}
                    title="Copy NRIC"
                  >
                    {copiedKey === 'nric' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
              )}
            </DetailField>

            <DetailField label="State / Branch">{formatValue(selectedCase.stateName)}</DetailField>
            <DetailField label="Channel To">{formatValue(selectedCase.channelTo)}</DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Section 3: Financial Details */}
        <DetailSection title="Financial & Risk Details" icon={<ShieldAlert size={13} />}>
          <DetailGrid>
            <DetailField label="Amount Involved" full>
              {formatValue(selectedCase.amountInvolved)}
            </DetailField>
          </DetailGrid>
        </DetailSection>
      </div>
    </Drawer>
  );
}
