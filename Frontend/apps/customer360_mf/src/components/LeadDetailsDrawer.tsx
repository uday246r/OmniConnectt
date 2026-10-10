import React from 'react';
import { useLeadStore } from '../store/leadStore';
import { FolderKanban, User, Phone, Mail, Building2, MapPin, Calendar, DollarSign, FileText, CheckCircle2, Hash, Briefcase } from '@omniconnect/ui/icons';
import { Badge, DetailField, DetailGrid, DetailSection, Drawer, EMPTY_VALUE } from '@omniconnect/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency } from '../shared/formatValue';
import styles from './ProductDetailsModal.module.css';
import { useShallow } from 'zustand/react/shallow';

export default function LeadDetailsDrawer() {
  const { selectedLead, drawerOpen, closeLeadDrawer } = useLeadStore(
    useShallow((s) => ({
      selectedLead: s.selectedLead,
      drawerOpen: s.drawerOpen,
      closeLeadDrawer: s.closeLeadDrawer,
    }))
  );

  if (!drawerOpen || !selectedLead) return null;

  const leadIdStr = String(selectedLead.id || '').trim();
  const title = selectedLead.name || 'Lead Details';
  const subtitle = `${selectedLead.product || 'Lead'}${leadIdStr ? ` • Ref #${leadIdStr}` : ''}`;

  return (
    <Drawer
      open={drawerOpen}
      onClose={closeLeadDrawer}
      closeLabel="Close lead details"
      title={title}
      subtitle={subtitle}
      icon={<FolderKanban size={20} />}
      footer={
        <div className={styles.footerSpread}>
          <div className={styles.footerMeta}>
            <span className={styles.footerAccountId}>
              Lead Ref: {leadIdStr || EMPTY_VALUE}
            </span>
          </div>
        </div>
      }
    >
      <div>
        {/* Hero Identity Overview Card */}
        <div className={styles.heroCard}>
          <div className={styles.heroLeft}>
            <div className={`${styles.heroAvatar} ${styles.heroAvatarGreen}`}>
              <FolderKanban size={24} />
            </div>
            <div className={styles.heroMeta}>
              <h3 className={styles.heroTitle}>{title}</h3>
              <div className={styles.heroTags}>
                <Badge tone="primary">{selectedLead.product || 'Product'}</Badge>
                {selectedLead.categoryName && <Badge tone="neutral">{selectedLead.categoryName}</Badge>}
                {leadIdStr && (
                  <span className={styles.accountPill}>
                    <Hash size={11} />
                    {leadIdStr}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={styles.heroRight}>
            <StatusBadge status={selectedLead.status} />
          </div>
        </div>

        {/* Quick Highlights Strip */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTilePrimary}`}>
              <DollarSign size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Applied Amount</span>
              <span className={styles.kpiValue}>
                {selectedLead.appliedAmount ? formatCurrency(selectedLead.appliedAmount) : EMPTY_VALUE}
              </span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTileEmerald}`}>
              <Building2 size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Branch</span>
              <span className={styles.kpiValue}>{selectedLead.branch || EMPTY_VALUE}</span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={`${styles.kpiIconBox} ${styles.kpiTileAmber}`}>
              <Calendar size={17} />
            </div>
            <div className={styles.kpiBody}>
              <span className={styles.kpiLabel}>Created Date</span>
              <span className={styles.kpiValue}>{formatValue(selectedLead.createdDate)}</span>
            </div>
          </div>
        </div>

        {/* Section 1: Customer Information */}
        <DetailSection title="Customer Information" icon={<User size={16} />}>
          <DetailGrid>
            <DetailField label="Customer Name">{formatValue(selectedLead.name)}</DetailField>
            <DetailField label="IC / ID Number" mono>{formatValue(selectedLead.icNumber)}</DetailField>
            <DetailField label="Phone Number">{formatValue(selectedLead.phone)}</DetailField>
            <DetailField label="Email Address">{formatValue(selectedLead.email)}</DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Section 2: Product & Application Details */}
        <DetailSection title="Product & Application Details" icon={<FileText size={16} />}>
          <DetailGrid>
            <DetailField label="Product Name">{formatValue(selectedLead.product)}</DetailField>
            <DetailField label="Category">{formatValue(selectedLead.categoryName)}</DetailField>
            <DetailField label="Sub-Category">{formatValue(selectedLead.subCategoryName)}</DetailField>
            <DetailField label="Application Status">
              <StatusBadge status={selectedLead.status} />
            </DetailField>
            <DetailField label="Applied Amount">
              {selectedLead.appliedAmount ? formatCurrency(selectedLead.appliedAmount) : EMPTY_VALUE}
            </DetailField>
            <DetailField label="Created Date">{formatValue(selectedLead.createdDate)}</DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Section 3: Branch & Assignment Details */}
        <DetailSection title="Branch & Assignment" icon={<MapPin size={16} />}>
          <DetailGrid>
            <DetailField label="State">{formatValue(selectedLead.state)}</DetailField>
            <DetailField label="Branch">{formatValue(selectedLead.branch)}</DetailField>
            <DetailField label="Preferred Sales Executive">
              {formatValue(selectedLead.preferredSalesExecutive)}
            </DetailField>
            {selectedLead.employerName && (
              <DetailField label="Employer Name">{formatValue(selectedLead.employerName)}</DetailField>
            )}
          </DetailGrid>
        </DetailSection>

        {/* Section 4: Specific / Corporate Details if present */}
        {(selectedLead.companyName || selectedLead.entityType || selectedLead.propertyType || selectedLead.propertyStatus || selectedLead.marketingConsent) && (
          <DetailSection title="Additional Details" icon={<Briefcase size={16} />}>
            <DetailGrid>
              {selectedLead.companyName && (
                <DetailField label="Company Name">{formatValue(selectedLead.companyName)}</DetailField>
              )}
              {selectedLead.entityType && (
                <DetailField label="Entity Type">{formatValue(selectedLead.entityType)}</DetailField>
              )}
              {selectedLead.dateOfIncorporation && (
                <DetailField label="Date of Incorporation">{formatValue(selectedLead.dateOfIncorporation)}</DetailField>
              )}
              {selectedLead.propertyType && (
                <DetailField label="Property Type">{formatValue(selectedLead.propertyType)}</DetailField>
              )}
              {selectedLead.propertyStatus && (
                <DetailField label="Property Status">{formatValue(selectedLead.propertyStatus)}</DetailField>
              )}
              {selectedLead.marketingConsent && (
                <DetailField label="Marketing Consent">{formatValue(selectedLead.marketingConsent)}</DetailField>
              )}
            </DetailGrid>
          </DetailSection>
        )}
      </div>
    </Drawer>
  );
}
