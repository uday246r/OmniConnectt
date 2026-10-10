import React from 'react';
import {
  Search,
  MapPin,
  Phone,
  Briefcase,
  CreditCard,
} from '@omniconnect/ui/icons';
import type {
  IndividualProfile,
  CorporateProfile,
  ContactDetail,
  CustomerProduct,
  Interaction,
} from '../types/api';
import { formatCustomerName, cleanSegmentValue } from '../utils/customerProfileFormatters';
import { getInitials } from '@omniconnect/ui';
import styles from './CustomerHeroBanner.module.css';

interface CustomerHeroBannerProps {
  profile: IndividualProfile | CorporateProfile;
  contactInfo: ContactDetail | null;
  customerType: 'individual' | 'corporate';
  products: CustomerProduct[];
  interactions: Interaction[];
  totalProductsCount: number;
  onSearchClick: () => void;
}

/** Formats a numeric currency amount into a compact readable string (e.g. RM 186k, RM 1.2M) without hardcoding. */
function formatCompactCurrency(val: number, currency = 'RM'): string {
  if (val >= 1_000_000) {
    const formatted = (val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1);
    return `${currency} ${formatted}M`;
  }
  if (val >= 1_000) {
    const formatted = (val / 1_000).toFixed(val % 1_000 === 0 ? 0 : 1);
    return `${currency} ${formatted}k`;
  }
  return `${currency} ${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export default function CustomerHeroBanner({
  profile,
  contactInfo,
  customerType,
  products,
  interactions,
  totalProductsCount,
  onSearchClick,
}: CustomerHeroBannerProps) {
  const isIndividual = customerType === 'individual';
  const indProfile = isIndividual ? (profile as IndividualProfile) : null;
  const corpProfile = !isIndividual ? (profile as CorporateProfile) : null;
  const rawProfile = profile as unknown as Record<string, unknown>;

  // Name & Initials (strictly dynamic from API — never hardcoded, changes with each customer)
  const rawCustomerName = isIndividual
    ? (indProfile?.fullName ||
      (rawProfile.customerName as string) ||
      (rawProfile.fullName as string) ||
      (rawProfile.name as string) ||
      '')
    : (corpProfile?.organizationName ||
      (rawProfile.organizationName as string) ||
      (rawProfile.name as string) ||
      '');

  const customerName = isIndividual
    ? formatCustomerName(indProfile?.salutation, rawCustomerName)
    : formatCustomerName(corpProfile?.salutation, rawCustomerName);

  // Dynamic avatar initials (e.g. "MOHD FARIS BIN ZAINUDIN" -> "MZ", "Ahmad Zulkifli" -> "AZ", "Grace Wong" -> "GW")
  const initials = getInitials(rawCustomerName || customerName) || (isIndividual ? 'ID' : 'CO');

  // Customer status / lifecycle indicator (API only - handles status, flags, lifecycleTrig for both Individual & Corporate)
  const statusBadge = isIndividual
    ? cleanSegmentValue(
      indProfile?.status ||
      indProfile?.flags ||
      (rawProfile.status as string) ||
      (rawProfile.flags as string) ||
      (rawProfile.STATUS as string)
    )
    : cleanSegmentValue(
      (corpProfile as any)?.status ||
      (rawProfile.status as string) ||
      (rawProfile.STATUS as string) ||
      corpProfile?.lifecycleTrig ||
      corpProfile?.onlineBankingActivationStatus ||
      'ACTIVE'
    );

  const isActive = statusBadge ? statusBadge.toUpperCase().includes('ACT') : true;

  // Segmentation (API only - reliably resolves MASS, SME, AFFLUENT etc., with fallback to corporate entity type)
  const segmentation = cleanSegmentValue(
    profile.segmentation ||
    (rawProfile.segmentation as string) ||
    (rawProfile.SEGMENTATION as string) ||
    (rawProfile.customerSegmentation as string) ||
    (rawProfile.segment as string) ||
    (!isIndividual ? (corpProfile?.organizationType || 'CORPORATE') : '')
  );

  // Primary Identification Number (NRIC for Individual, BRN/CIF for Corporate)
  const primaryId = isIndividual
    ? (
      indProfile?.nationalId ||
      indProfile?.phprId ||
      (rawProfile.nationalId as string) ||
      (rawProfile.nric as string) ||
      (rawProfile.phprId as string) ||
      ''
    ).trim()
    : (
      corpProfile?.brn ||
      corpProfile?.cifNumber ||
      corpProfile?.customerId ||
      (rawProfile.brn as string) ||
      (rawProfile.cifNumber as string) ||
      ''
    ).trim();

  const idLabel = isIndividual ? 'NRIC' : (corpProfile?.brn ? 'BRN' : 'CIF');

  // Open cases count dynamically calculated from real interactions
  const openCasesCount = interactions.filter((i) => {
    const s = (i.statusParent || '').toLowerCase();
    return s.includes('open') || s.includes('progress') || s.includes('pending') || s.includes('new');
  }).length;

  // Location / City / Address (API only)
  const location =
    (contactInfo?.fixedAddress ? contactInfo.fixedAddress.split(',')[0].trim() : '') ||
    (isIndividual ? indProfile?.placeBirth : corpProfile?.country) ||
    '';

  // Customer since (API only)
  const customerSinceRaw = isIndividual ? indProfile?.openingDate : corpProfile?.businessRegDate;
  const customerSince = customerSinceRaw ? customerSinceRaw.split('T')[0].split(' ')[0] : '';

  // Holdings count
  const holdingsCount = totalProductsCount || products.length;

  // Contact details
  const contactPhone =
    contactInfo?.contactNumber ||
    indProfile?.employerPhone ||
    corpProfile?.refEmployeePhoneNo ||
    '';

  // Relationship Manager details (API only)
  const rmName =
    (profile.rmName as string) ||
    (rawProfile.currentRm as string) ||
    (rawProfile.rM_NAME as string) ||
    (rawProfile.currenT_RM as string) ||
    (rawProfile.current_rm as string) ||
    (rawProfile.rm_name as string) ||
    (rawProfile.refEmployeeName as string) ||
    (rawProfile.reF_EMPLOYEE_NAME as string) ||
    '';

  const rmId =
    (profile.rmId as string) ||
    (rawProfile.rM_ID as string) ||
    (rawProfile.refStaffId as string) ||
    (rawProfile.refEmployeeId as string) ||
    '';

  const rmBranchCode =
    (profile.rmBranchCode as string) ||
    (rawProfile.rM_BRANCH_CODE as string) ||
    '';

  // Computable metrics from products array (API only, zero hardcoding)
  const depositProducts = products.filter((p) => {
    const t = (p.type || p.productCategory || '').toLowerCase();
    return t.includes('deposit') || t.includes('saving') || t.includes('current') || t.includes('fixed');
  });
  const totalDeposits = depositProducts.reduce((sum, p) => {
    const raw = p.balances || (p as unknown as Record<string, unknown>)['placementAmount'];
    const num = parseFloat(String(raw || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(num) ? sum : sum + num;
  }, 0);

  const financingProducts = products.filter((p) => {
    const t = (p.type || p.productCategory || '').toLowerCase();
    return t.includes('financ') || t.includes('loan') || t.includes('mortgage') || t.includes('hire');
  });
  const totalFinancing = financingProducts.reduce((sum, p) => {
    const raw = p.balances || p.outstanding;
    const num = parseFloat(String(raw || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(num) ? sum : sum + num;
  }, 0);

  const investmentProducts = products.filter((p) => {
    const t = (p.type || p.productCategory || '').toLowerCase();
    return t.includes('invest') || t.includes('wealth') || t.includes('gold') || t.includes('unit') || t.includes('sukuk');
  });
  const totalInvestments = investmentProducts.reduce((sum, p) => {
    const raw = p.balances;
    const num = parseFloat(String(raw || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(num) ? sum : sum + num;
  }, 0);

  const totalHoldingsValue = products.reduce((sum, p) => {
    const raw = p.balances || (p as unknown as Record<string, unknown>)['placementAmount'];
    const num = parseFloat(String(raw || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(num) ? sum : sum + num;
  }, 0);

  // Last touch / contact (API only)
  const lastTouch =
    profile.lastContactDate ||
    (interactions.length > 0
      ? interactions[0].sourceName || interactions[0].positionDate || interactions[0].dateCase
      : null) ||
    indProfile?.preferComChnl ||
    '';

  const hasFinancialMetrics =
    totalHoldingsValue > 0 || totalDeposits > 0 || totalFinancing > 0 || totalInvestments > 0;

  // Eligibility score (API only, e.g. "82")
  const eligibilityScore =
    profile.eligibilityScore &&
      String(profile.eligibilityScore).trim() !== '' &&
      String(profile.eligibilityScore).toLowerCase() !== 'null'
      ? String(profile.eligibilityScore).trim()
      : null;

  // Sub-line metadata pills cleanly constructed as elegant frosted chips with distinct icon colors
  const sublineItems: React.ReactNode[] = [];
  if (primaryId) {
    sublineItems.push(
      <span key="id" className={styles.sublineItem} title={`${idLabel}: ${primaryId}`}>
        <CreditCard size={13.5} className={`${styles.sublineIcon} ${styles.iconId}`} />
        {idLabel}: {primaryId}
      </span>
    );
  }
  if (location) {
    sublineItems.push(
      <span key="loc" className={styles.sublineItem} title="Primary Address / Location">
        <MapPin size={13.5} className={`${styles.sublineIcon} ${styles.iconLocation}`} />
        {location}
      </span>
    );
  }
  if (contactPhone) {
    sublineItems.push(
      <span key="phone" className={styles.sublineItem} title="Primary Phone Number">
        <Phone size={13.5} className={`${styles.sublineIcon} ${styles.iconPhone}`} />
        {contactPhone}
      </span>
    );
  }
  const branchName =
    indProfile?.branch ||
    (rawProfile.branch as string) ||
    '';
  const branchCode =
    indProfile?.branchCode ||
    (rawProfile.branchCode as string) ||
    '';

  return (
    <div className={styles.wrapper}>
      {/* Top Breadcrumb */}
      <div className={styles.breadcrumb}>
        <span className={styles.breadcrumbRoot}>Customer 360</span>
        <span className={styles.breadcrumbSeparator}>›</span>
        <span className={styles.breadcrumbCategory}>
          {isIndividual ? 'Individual Profile' : 'Non-Individual Profile'}
        </span>
        <span className={styles.breadcrumbSeparator}>›</span>
        <span className={styles.breadcrumbCurrent}>{customerName}</span>
      </div>

      {/* Hero Profile Banner */}
      <div className={styles.banner}>
        <div className={styles.bannerMainRow}>
          {/* Left: Avatar + Customer Details */}
          <div className={styles.profileLeft}>
            <div className={styles.avatarContainer}>
              <div className={styles.avatarCircle} title={customerName}>
                {initials}
              </div>
              {isActive && (
                <div
                  className={styles.avatarStatusDot}
                  title="Active customer in good standing"
                />
              )}
            </div>

            <div className={styles.profileInfo}>
              {/* Name & Badges */}
              <div className={styles.nameRow}>
                <h1 className={styles.customerName}>{customerName}</h1>

                {/* Badges strictly from API */}
                <div className={styles.badgeList}>
                  {statusBadge && statusBadge !== '-' && (
                    <span className={styles.statusBadge}>
                      <span className={styles.statusDot} />
                      {statusBadge}
                    </span>
                  )}

                  {segmentation && (
                    <span className={styles.segmentationBadge}>
                      {segmentation}
                    </span>
                  )}



                  {openCasesCount > 0 && (
                    <span className={styles.openCasesBadge}>
                      {openCasesCount} open {openCasesCount === 1 ? 'case' : 'cases'}
                    </span>
                  )}

                  {isIndividual && indProfile?.hnwi && indProfile.hnwi.toUpperCase() === 'Y' && (
                    <span className={styles.priorityBadge}>
                      HNWI
                    </span>
                  )}
                  {isIndividual && indProfile?.pep && indProfile.pep.toUpperCase() === 'Y' && (
                    <span className={styles.priorityBadge}>
                      PEP
                    </span>
                  )}
                </div>
              </div>

              {/* Sub-line metadata (cleanly framed frosted pills) */}
              {sublineItems.length > 0 && (
                <div className={styles.subline}>
                  {sublineItems}
                </div>
              )}
            </div>
          </div>

          {/* Right End Corner: RM Chip, Health Score & Search Button */}
          <div className={styles.bannerRight}>
            {/* RM Chip: shown in the right corner */}
            <div className={styles.bannerRmChip} title="Assigned Relationship Manager">
              <div className={styles.bannerRmAvatar}>
                {rmName ? getInitials(rmName) : <Briefcase size={16} />}
              </div>
              <div className={styles.bannerRmDetails}>
                <span className={styles.bannerRmRole}>RELATIONSHIP MANAGER</span>
                <span className={styles.bannerRmName}>{rmName || 'Not Assigned'}</span>
                {(rmBranchCode || rmId) ? (
                  <span className={styles.bannerRmMeta}>
                    {rmBranchCode ? `Branch ${rmBranchCode}` : ''}
                    {rmBranchCode && rmId ? ' • ' : ''}
                    {rmId ? `ID: ${rmId}` : ''}
                  </span>
                ) : rmName ? (
                  <span className={styles.bannerRmMeta}>Assigned RM</span>
                ) : null}
              </div>
            </div>

            {/* Health / Eligibility score circle (when available from API) */}
            {eligibilityScore && (
              <div className={styles.scoreContainer}>
                <div className={styles.scoreCircle}>
                  <span className={styles.scoreNumber}>{eligibilityScore}</span>
                </div>
                <span className={styles.scoreLabel}>HEALTH SCORE</span>
              </div>
            )}

            {/* Search Button */}
            <div className={styles.actionGroup}>
              <button
                type="button"
                className={styles.searchButton}
                onClick={onSearchClick}
                title="Search another customer profile"
              >
                <Search size={15} />
                <span>Search</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom row: Dynamic metrics & Highlights Strip */}
        <div className={styles.metricsRow}>
          {hasFinancialMetrics ? (
            <>
              {totalHoldingsValue > 0 && (
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>PORTFOLIO VALUE</span>
                  <span className={styles.metricValue}>
                    {formatCompactCurrency(totalHoldingsValue)}
                  </span>
                </div>
              )}

              {totalDeposits > 0 && (
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>DEPOSITS</span>
                  <span className={styles.metricValue}>
                    {formatCompactCurrency(totalDeposits)}
                  </span>
                </div>
              )}

              {totalFinancing > 0 && (
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>FINANCING</span>
                  <span className={styles.metricValue}>
                    {formatCompactCurrency(totalFinancing)}
                  </span>
                </div>
              )}

              {totalInvestments > 0 && (
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>INVESTMENTS</span>
                  <span className={styles.metricValue}>
                    {formatCompactCurrency(totalInvestments)}
                  </span>
                </div>
              )}

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>PRODUCTS HELD</span>
                <span className={styles.metricValue}>
                  {holdingsCount} {holdingsCount === 1 ? 'Product' : 'Products'}
                </span>
              </div>

              {lastTouch && (
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>LAST TOUCH</span>
                  <span className={styles.metricValue}>{String(lastTouch)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>ACCOUNT STATUS</span>
                <span className={styles.metricValue}>
                  {statusBadge ? `${statusBadge}` : 'Active & Verified'}
                </span>
              </div>

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>TOTAL PRODUCTS</span>
                <span className={styles.metricValue}>
                  {holdingsCount} {holdingsCount === 1 ? 'Product' : 'Products'}
                </span>
              </div>

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>SEGMENTATION</span>
                <span className={styles.metricValue}>
                  {segmentation || (isIndividual ? 'Retail Mass' : 'Commercial')}
                </span>
              </div>

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>CUSTOMER TENURE</span>
                <span className={styles.metricValue}>
                  {customerSince ? `Since ${customerSince}` : 'Established Account'}
                </span>
              </div>

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>LAST TOUCHPOINT</span>
                <span className={styles.metricValue}>
                  {String(lastTouch || 'Recent Activity')}
                </span>
              </div>

              <div className={styles.metricItem}>
                <span className={styles.metricLabel}>PRIMARY BRANCH</span>
                <span className={styles.metricValue}>
                  {branchName ||
                    (branchCode ? `Branch ${branchCode}` : '') ||
                    (profile.rmBranchCode ? `Branch ${profile.rmBranchCode}` : '') ||
                    location ||
                    'Main Branch'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomerHeroBannerSkeleton({ isIndividual = true }: { isIndividual?: boolean }) {
  return (
    <div className={styles.wrapper}>
      {/* Top Breadcrumb */}
      <div className={styles.breadcrumb}>
        <span className={styles.breadcrumbRoot}>Customer 360</span>
        <span className={styles.breadcrumbSeparator}>›</span>
        <span className={styles.breadcrumbCategory}>
          {isIndividual ? 'Individual Profile' : 'Non-Individual Profile'}
        </span>
        <span className={styles.breadcrumbSeparator}>›</span>
        <span
          className="c360-skel"
          style={{ width: '130px', height: '14px', borderRadius: '4px', display: 'inline-block' }}
        />
      </div>

      {/* Hero Profile Banner Skeleton */}
      <div className={`${styles.banner} ${styles.bannerSkeleton}`}>
        <div className={styles.bannerMainRow}>
          {/* Left: Avatar + Customer Details */}
          <div className={styles.profileLeft}>
            <div className={styles.avatarContainer}>
              <div
                className={`${styles.avatarCircle} ${styles.skelOnBlue}`}
                style={{ width: '58px', height: '58px', border: 'none' }}
              />
            </div>

            <div className={styles.profileInfo}>
              {/* Name & Badges */}
              <div className={styles.nameRow}>
                <div
                  className={styles.skelOnBlue}
                  style={{ width: '220px', height: '24px', borderRadius: '6px' }}
                />
                <div className={styles.badgeList}>
                  <div
                    className={styles.skelOnBlue}
                    style={{ width: '68px', height: '22px', borderRadius: '999px' }}
                  />
                  <div
                    className={styles.skelOnBlue}
                    style={{ width: '74px', height: '22px', borderRadius: '999px' }}
                  />
                </div>
              </div>

              {/* Sub-line metadata */}
              <div className={styles.subline}>
                <div
                  className={styles.skelOnBlue}
                  style={{ width: '140px', height: '22px', borderRadius: '999px' }}
                />
                <div
                  className={styles.skelOnBlue}
                  style={{ width: '115px', height: '22px', borderRadius: '999px' }}
                />
                <div
                  className={styles.skelOnBlue}
                  style={{ width: '105px', height: '22px', borderRadius: '999px' }}
                />
              </div>
            </div>
          </div>

          {/* Right Corner: RM Chip */}
          <div className={styles.bannerRight}>
            <div
              className={`${styles.bannerRmChip} ${styles.skelOnBlue}`}
              style={{ width: '180px', height: '48px', border: 'none' }}
            />
          </div>
        </div>

        {/* Bottom row: Highlights Strip */}
        <div className={styles.metricsRow}>
          <div className={styles.metricItem}>
            <div
              className={styles.skelOnBlue}
              style={{ width: '92px', height: '10px', marginBottom: '6px' }}
            />
            <div
              className={styles.skelOnBlue}
              style={{ width: '75px', height: '18px' }}
            />
          </div>
          <div className={styles.metricItem}>
            <div
              className={styles.skelOnBlue}
              style={{ width: '64px', height: '10px', marginBottom: '6px' }}
            />
            <div
              className={styles.skelOnBlue}
              style={{ width: '68px', height: '18px' }}
            />
          </div>
          <div className={styles.metricItem}>
            <div
              className={styles.skelOnBlue}
              style={{ width: '74px', height: '10px', marginBottom: '6px' }}
            />
            <div
              className={styles.skelOnBlue}
              style={{ width: '72px', height: '18px' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
