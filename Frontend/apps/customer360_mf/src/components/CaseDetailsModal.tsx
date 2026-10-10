import React from 'react';
import { useInteractionStore } from '../store/interactionStore';
import { FileText, User, ShieldAlert, Hash, Calendar, Layers, Activity } from '@omniconnect/ui/icons';
import { Badge, DetailField, DetailGrid, DetailSection, Drawer, EMPTY_VALUE } from '@omniconnect/ui';
import { formatValue } from '../shared/formatValue';
import styles from './ProductDetailsModal.module.css';
import { useShallow } from 'zustand/react/shallow';

export default function CaseDetailsModal() {
  const { selectedCase, modalOpen, closeCaseModal } = useInteractionStore(
    useShallow((s) => ({
      selectedCase: s.selectedCase,
      modalOpen: s.modalOpen,
      closeCaseModal: s.closeCaseModal,
    }))
  );

  if (!modalOpen || !selectedCase) return null;

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
          </div>
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
              {formatValue(selectedCase.contactNo)}
            </DetailField>

            <DetailField label="National ID / IC" mono>
              {formatValue(selectedCase.nric)}
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
