import React, { useState, useEffect, type ReactNode } from 'react';
import { useProductStore } from '../store/productStore';
import { useCustomerStore } from '../store/customerStore';
import {
  Landmark,
  FileText,
  DollarSign,
  Percent,
  CreditCard,
  Coins,
  TrendingUp,
  ScrollText,
  Calendar,
  Check,
  Copy,
  Hash,
  CheckCircle2,
  Building,
  Layers,
} from '@omniremit/ui/icons';
import type { AnyProductFields, ProductDetailType, CorporateProfile } from '../types/api';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney, resolveProductStatus } from '../shared/formatValue';
import { Button, Badge, DetailField, DetailGrid, DetailSection, Drawer, EMPTY_VALUE, isEmptyDetailValue } from '@omniremit/ui';
import styles from './ProductDetailsModal.module.css';

// ---------------------------------------------------------------------------
// Product type detection — mirrors the routing logic in productStore.ts
// ---------------------------------------------------------------------------
function detectProductType(details: AnyProductFields | null): ProductDetailType {
  const normType = (details?.type || details?.productCategory || '').toLowerCase();
  if (normType.includes('loan') || normType.includes('financing')) return 'loan';
  if (normType.includes('deposit') || normType.includes('casa')) return 'deposit';
  if (normType.includes('card')) return 'card';
  if (normType.includes('gold')) return 'gold';
  if (normType.includes('wm') || normType.includes('wealth') || normType.includes('takaful')) return 'wm';
  if (normType.includes('unit trust')) return 'unittrust';
  if (normType.includes('will')) return 'willwriting';
  return 'loan'; // fallback: closest to the generic account-detail shape
}

interface FieldCardProps {
  label: string;
  value?: ReactNode;
  mono?: boolean;
  bold?: boolean;
  emerald?: boolean;
  fullWidth?: boolean;
  copyKey?: string;
  copyValue?: string | null;
  onCopy?: (key: string, text?: string | null) => void;
  copiedKey?: string | null;
}

/** One field, rendered through the shared `DetailField` — a value that resolves to EMPTY_VALUE is
 * omitted by `DetailField` itself, so a product with 10 of its 25 possible fields populated renders
 * 10 fields, not 10 values and 15 blanks. */
const FieldCard = ({
  label,
  value,
  mono,
  bold,
  emerald,
  fullWidth,
  copyKey,
  copyValue,
  onCopy,
  copiedKey,
}: FieldCardProps) => {
  const isCopied = copyKey && copiedKey === copyKey;
  const valText = typeof value === 'string' ? value : '';
  const canCopy = onCopy && copyKey && (copyValue || valText) && valText !== EMPTY_VALUE;

  // The value is always wrapped in a <span> below (for the optional copy button), which defeats
  // DetailField's own built-in emptiness check — it only sees through a plain string. Do that check
  // here instead, on the raw value, so a field the CRM never populated is skipped rather than shown
  // as an empty card.
  if (isEmptyDetailValue(value ?? EMPTY_VALUE)) return null;

  return (
    <DetailField label={label} full={fullWidth}>
      <span className={styles.fieldValueRow}>
        <span
          className={`${mono ? styles.fieldValueMono : ''}${bold ? ` ${styles.fieldValueBold}` : ''}${
            emerald ? ` ${styles.fieldValueEmerald}` : ''
          }`}
        >
          {value ?? EMPTY_VALUE}
        </span>
        {canCopy && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(copyKey, copyValue || valText);
            }}
            className={`${styles.copyBtn}${isCopied ? ` ${styles.copyBtnCopied}` : ''}`}
            title="Copy value"
          >
            {isCopied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </span>
    </DetailField>
  );
};

export default function ProductDetailsModal() {
  const { selectedProductDetails, modalOpen, loadingDetails, closeProductModal } = useProductStore();
  const { customerType, profile } = useCustomerStore();
  const isCorp = customerType === 'corporate';
  const profileCountry = (profile as CorporateProfile | null)?.country;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Track product detail view for audit log
  useEffect(() => {
    if (!modalOpen || !selectedProductDetails) return;
    const d = selectedProductDetails as AnyProductFields | null;
    const accountNoStr = String(
      d?.accountNumber || d?.accountNo || d?.cardNo || d?.goldAccountNo ||
      d?.investmentAccountNo || d?.willWritingRefNo || d?.policyNo || ''
    ).trim();
    const productName = d?.productName || d?.planName || d?.fundName || d?.cardTypeDesc || d?.type || '';
    const entityLabel = productName || accountNoStr || 'Product';
    window.dispatchEvent(new CustomEvent('omni:track-activity', {
      detail: {
        page: 'all-products',
        module: 'Customer 360',
        sourceApplication: 'Customer 360',
        action: 'customer.details_viewed',
        actionCategory: 'ViewDetails',
        entityType: 'Product',
        entityLabel,
        entityId: accountNoStr || undefined,
      },
    }));
  }, [modalOpen, selectedProductDetails]);

  const formatCurrency = (val: unknown) => formatMoney(val, profileCountry);

  const handleCopyText = (key: string, text?: string | null) => {
    if (!text || text === EMPTY_VALUE) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  if (!modalOpen) return null;

  const d = selectedProductDetails as AnyProductFields | null;
  const productType = detectProductType(d);

  const accountNoStr = String(
    d?.accountNumber ||
    d?.accountNo ||
    d?.cardNo ||
    d?.goldAccountNo ||
    d?.investmentAccountNo ||
    d?.willWritingRefNo ||
    d?.policyNo ||
    ''
  ).trim();

  const productName =
    d?.productName ||
    d?.planName ||
    d?.fundName ||
    d?.cardTypeDesc ||
    d?.type ||
    'Banking Product';

  const categoryName = d?.productCategory || d?.type || (isCorp ? 'Corporate Banking' : 'Individual Banking');
  const statusStr = resolveProductStatus(d);

  // Dynamic drawer category icon
  const getCategoryIcon = (type: ProductDetailType, size: number = 20) => {
    switch (type) {
      case 'deposit':
        return <Landmark size={size} />;
      case 'card':
        return <CreditCard size={size} />;
      case 'gold':
        return <Coins size={size} />;
      case 'wm':
      case 'unittrust':
        return <TrendingUp size={size} />;
      case 'willwriting':
        return <ScrollText size={size} />;
      case 'loan':
      default:
        return <FileText size={size} />;
    }
  };

  const getAvatarStyle = (type: ProductDetailType) => {
    switch (type) {
      case 'deposit':
        return styles.heroAvatarGreen;
      case 'card':
        return styles.heroAvatarPurple;
      case 'gold':
        return styles.heroAvatarAmber;
      default:
        return styles.heroAvatar;
    }
  };

  // Quick KPI Highlights
  const primaryAmount = formatCurrency(
    d?.balances ||
    d?.financingAmount ||
    d?.placementAmount ||
    d?.creditLimit ||
    d?.totalAmount ||
    d?.basicContributionAmount
  );

  const amountLabel =
    productType === 'card'
      ? 'Credit Limit'
      : productType === 'loan'
      ? 'Financing Amount'
      : productType === 'gold'
      ? 'Total Value'
      : 'Account Balance';

  const tenureLabel = d?.tenure ? 'Facility Tenure' : 'Opening / Start Date';
  const tenureValue = d?.tenure
    ? `${d.tenure} ${typeof d.tenure === 'number' || !isNaN(Number(d.tenure)) ? 'Months' : ''}`
    : formatValue(
        d?.accountOpeningDate ||
        d?.commencementDate ||
        d?.cardIssuanceDate ||
        d?.disbursedDate ||
        d?.positionDate
      );

  const renderField = (
    label: string,
    val: unknown,
    opts?: {
      mono?: boolean;
      bold?: boolean;
      emerald?: boolean;
      fullWidth?: boolean;
      copyKey?: string;
      copyValue?: string | null;
      isCurrency?: boolean;
    }
  ) => {
    const formatted = opts?.isCurrency ? formatCurrency(val) : formatValue(val);
    return (
      <FieldCard
        label={label}
        value={formatted}
        mono={opts?.mono}
        bold={opts?.bold}
        emerald={opts?.emerald}
        fullWidth={opts?.fullWidth}
        copyKey={opts?.copyKey}
        copyValue={opts?.copyValue ?? (typeof val === 'string' ? val : undefined)}
        onCopy={handleCopyText}
        copiedKey={copiedKey}
      />
    );
  };

  /** True when every one of a section's raw field values is empty — used to hide a section whose
   * fields all vanished (via `renderField`'s own `FieldCard` check) rather than leave its title pill
   * floating over an empty card. Not applied to sections that also carry a `StatusBadge` field: that
   * badge always renders something (even a "—" placeholder), so the section is never truly empty. */
  const allEmpty = (...vals: unknown[]) => vals.every((v) => isEmptyDetailValue(formatValue(v)));

  const renderCorporateSections = () => {
    if (!d) return null;

    if (productType === 'deposit') {
      return (
        <>
          <DetailSection title="Financing & Account Information" icon={<Landmark size={13} />}>
            <DetailGrid>
              {renderField('Position Date', d.positionDate)}
              {renderField('Product Category', d.productCategory)}
              {renderField('Product Name', d.productName, { bold: true })}
              {renderField('Account Number', d.accountNumber || d.accountNo, { mono: true, copyKey: 'corpAcc' })}
              <DetailField label="Account Status">
                <StatusBadge status={d.derivedAccountStatus} dot />
              </DetailField>
              {renderField('Balances', d.balances, { isCurrency: true, emerald: true })}
              {renderField('Placement Amount', d.placementAmount, { isCurrency: true })}
              {renderField('Tenure', d.tenure)}
              {renderField('Branch Account', d.branchAccount)}
              {renderField('State Account', d.stateAccount)}
              {renderField('HSMM Rates', d.hsmmRates)}
              {renderField('Maturity Instruction', d.maturityInstruction)}
              {renderField('Crediting CASA Account No', d.creditingCasaAccountNo, { mono: true, copyKey: 'casaNo' })}
              {renderField('Blocking Reasons', d.blockingReasons)}
              {renderField('PHPR ID', d.phprId, { mono: true })}
              {renderField('Cust ID', d.custId, { mono: true })}
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Important Dates"
            icon={<Calendar size={13} />}
            hidden={allEmpty(d.accountOpeningDate, d.maturityDate)}
          >
            <DetailGrid>
              {renderField('Account Opening Date', d.accountOpeningDate)}
              {renderField('Maturity Date', d.maturityDate)}
            </DetailGrid>
          </DetailSection>
        </>
      );
    }

    if (productType === 'card') {
      return (
        <>
          <DetailSection title="Card & Account Information" icon={<CreditCard size={13} />}>
            <DetailGrid>
              {renderField('Position Date', d.positionDate)}
              {renderField('Card Type', d.cardTypeDesc || d.cardType)}
              {renderField('Product Name', d.productName, { bold: true })}
              {renderField('Account No', d.accountNo || d.accountNumber, { mono: true, copyKey: 'cardAcc' })}
              {renderField('Card No', d.cardNo, { mono: true, copyKey: 'cardNo' })}
              <DetailField label="Card Status">
                <StatusBadge status={d.cardStatus} dot />
              </DetailField>
              {renderField('Credit Limit', d.creditLimit, { isCurrency: true, bold: true })}
              {renderField('Outstanding', d.outstanding, { isCurrency: true })}
              {renderField('Current Due', d.currentDue, { isCurrency: true })}
              {renderField('Profit Interest Rate', d.profitInterestRate)}
              {renderField('Original Rate', d.originalRate)}
              {renderField('Current Rate', d.currentRate)}
              {renderField('Pay Off Amount', d.payOffAmount, { isCurrency: true })}
              {renderField('BRN', d.brn, { mono: true })}
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Important Dates"
            icon={<Calendar size={13} />}
            hidden={allEmpty(d.cardIssuanceDate, d.cardExpiredDate)}
          >
            <DetailGrid>
              {renderField('Card Issuance Date', d.cardIssuanceDate)}
              {renderField('Card Expired Date', d.cardExpiredDate)}
            </DetailGrid>
          </DetailSection>
        </>
      );
    }

    // Default: Corporate Loan / Financing
    return (
      <>
        <DetailSection title="Financing & Account Information" icon={<FileText size={13} />}>
          <DetailGrid>
            {renderField('Position Date', d.positionDate)}
            {renderField('Product Category', d.productCategory)}
            {renderField('Product Name', d.productName, { bold: true })}
            {renderField('Account No', d.accountNo || d.accountNumber, { mono: true, copyKey: 'loanAcc' })}
            <DetailField label="Financing Status">
              <StatusBadge status={d.financingStatus || d.derivedAccountStatus} dot />
            </DetailField>
            {renderField('Financing Amount', d.financingAmount || d.placementAmount, { isCurrency: true, emerald: true })}
            {renderField('Outstanding', d.outstanding || d.balances, { isCurrency: true })}
            {renderField('Monthly Installment', d.monthlyInstallment, { isCurrency: true })}
            {renderField('Original Rate', d.originalRate)}
            {renderField('Current Rate', d.currentRate || d.hsmmRates)}
            {renderField('Tenure', d.tenure)}
            {renderField('Pay Off Amount', d.payOffAmount, { isCurrency: true })}
            {renderField('ILOM SEQ', d.ilomSeq, { mono: true })}
            {renderField('Title No', d.titleNo, { mono: true })}
            {renderField('PHPR ID', d.phprId, { mono: true })}
            {renderField('MRPR ID', d.mrprId, { mono: true })}
            {renderField('Cust ID', d.custId, { mono: true })}
          </DetailGrid>
        </DetailSection>

        <DetailSection
          title="Important Dates"
          icon={<Calendar size={13} />}
          hidden={allEmpty(d.disbursedDate || d.accountOpeningDate, d.maturityDate)}
        >
          <DetailGrid>
            {renderField('Disbursed Date', d.disbursedDate || d.accountOpeningDate)}
            {renderField('Maturity Date', d.maturityDate)}
          </DetailGrid>
        </DetailSection>

        {(d.vehicleModel || d.propertyType || d.propertyValuePrice || d.propertyAddress) && (
          <DetailSection title="Collateral Details" icon={<Building size={13} />}>
            <DetailGrid>
              {renderField('Vehicle Model', d.vehicleModel)}
              {renderField('Property Type', d.propertyType)}
              {renderField('Property Value Price', d.propertyValuePrice, { isCurrency: true })}
              {renderField('Property Address', d.propertyAddress, { fullWidth: true })}
            </DetailGrid>
          </DetailSection>
        )}
      </>
    );
  };

  const renderIndividualSections = () => {
    if (!d) return null;

    if (productType === 'card') {
      return (
        <>
          <DetailSection title="Card Information" icon={<CreditCard size={13} />}>
            <DetailGrid>
              {renderField('Card No', d.cardNo, { mono: true, copyKey: 'indCardNo' })}
              {renderField('Card Type', d.cardTypeDesc || d.cardType)}
              {renderField('Account No', d.accountNo || d.accountNumber, { mono: true, copyKey: 'indCardAcc' })}
              <DetailField label="Card Status">
                <StatusBadge status={d.cardStatus} dot />
              </DetailField>
              {renderField('Card Issuance Date', d.cardIssuanceDate)}
              {renderField('Card Expiry Date', d.cardExpiredDate)}
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Balances & Rates"
            icon={<DollarSign size={13} />}
            hidden={allEmpty(d.creditLimit, d.outstanding, d.currentDue, d.payOffAmount, d.profitInterestRate, d.currentRate, d.casaBalance)}
          >
            <DetailGrid>
              {renderField('Credit Limit', d.creditLimit, { isCurrency: true, emerald: true })}
              {renderField('Outstanding', d.outstanding, { isCurrency: true })}
              {renderField('Current Due', d.currentDue, { isCurrency: true })}
              {renderField('Pay Off Amount', d.payOffAmount, { isCurrency: true })}
              {renderField('Profit Interest Rate', d.profitInterestRate)}
              {renderField('Current Rate', d.currentRate)}
              {d.casaBalance ? renderField('CASA Balance', d.casaBalance, { isCurrency: true }) : null}
            </DetailGrid>
          </DetailSection>
        </>
      );
    }

    if (productType === 'gold') {
      return (
        <DetailSection title="Gold Account Information" icon={<Coins size={13} />}>
          <DetailGrid>
            {renderField('Gold Account No', d.goldAccountNo || d.accountNo || d.accountNumber, { mono: true, copyKey: 'goldAcc' })}
            {renderField('Account Type', d.accountType)}
            <DetailField label="Status">
              <StatusBadge status={d.status} dot />
            </DetailField>
            {renderField('XAU Balance (Gram)', d.xauBalance, { bold: true })}
            {renderField('Total Amount', d.totalAmount, { isCurrency: true, emerald: true })}
            {renderField('Bank Buy / Sell', d.bankBuySell)}
            {renderField('Created Date', d.createdDate)}
          </DetailGrid>
        </DetailSection>
      );
    }

    if (productType === 'unittrust') {
      return (
        <DetailSection
          title="Unit Trust Information"
          icon={<TrendingUp size={13} />}
          hidden={allEmpty(d.investmentAccountNo || d.accountNo || d.accountNumber, d.fundName, d.unitHoldings, d.positionDate)}
        >
          <DetailGrid>
            {renderField('Investment Account No', d.investmentAccountNo || d.accountNo || d.accountNumber, { mono: true, copyKey: 'utAcc' })}
            {renderField('Fund Name', d.fundName, { fullWidth: true, bold: true })}
            {renderField('Unit Holdings', d.unitHoldings, { bold: true })}
            {renderField('Position Date', d.positionDate)}
          </DetailGrid>
        </DetailSection>
      );
    }

    if (productType === 'willwriting') {
      return (
        <DetailSection
          title="Will Writing Information"
          icon={<ScrollText size={13} />}
          hidden={allEmpty(d.willWritingRefNo || d.accountNo || d.accountNumber, d.productName, d.tarikhDaftarWasiat, d.positionDate)}
        >
          <DetailGrid>
            {renderField('Will Writing Ref No', d.willWritingRefNo || d.accountNo || d.accountNumber, { mono: true, copyKey: 'willRef' })}
            {renderField('Product Name', d.productName, { fullWidth: true, bold: true })}
            {renderField('Registration Date (Tarikh Daftar)', d.tarikhDaftarWasiat)}
            {renderField('Position Date', d.positionDate)}
          </DetailGrid>
        </DetailSection>
      );
    }

    if (productType === 'deposit') {
      return (
        <>
          <DetailSection title="Account Information" icon={<Landmark size={13} />}>
            <DetailGrid>
              {renderField('Account No', d.accountNumber || d.accountNo, { mono: true, copyKey: 'depAcc' })}
              <DetailField label="Account Status">
                <StatusBadge status={d.derivedAccountStatus} dot />
              </DetailField>
              {renderField('Tenure', d.tenure)}
              {renderField('Maturity Date', d.maturityDate)}
              {renderField('Branch Account', d.branchAccount)}
              {renderField('Account Opening Date', d.accountOpeningDate)}
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Balances & Rates"
            icon={<DollarSign size={13} />}
            hidden={allEmpty(d.balances, d.placementAmount, d.hsmmRates, d.maturityInstruction)}
          >
            <DetailGrid>
              {renderField('Balances', d.balances, { isCurrency: true, emerald: true })}
              {renderField('Placement Amount', d.placementAmount, { isCurrency: true })}
              {renderField('HSMM Rates', d.hsmmRates)}
              {renderField('Maturity Instruction', d.maturityInstruction)}
            </DetailGrid>
          </DetailSection>
        </>
      );
    }

    // Default: Loan / Financing
    return (
      <>
        <DetailSection title="Account Information" icon={<FileText size={13} />}>
          <DetailGrid>
            {renderField('Account No', d.accountNo || d.accountNumber, { mono: true, copyKey: 'loanAcc' })}
            <DetailField label="Financing Status">
              <StatusBadge status={d.financingStatus} dot />
            </DetailField>
            {renderField('Tenure (Months)', d.tenure)}
            {renderField('Maturity Date', d.maturityDate)}
          </DetailGrid>
        </DetailSection>

        <DetailSection
          title="Financing & Balances"
          icon={<DollarSign size={13} />}
          hidden={allEmpty(d.financingAmount, d.outstanding, d.payOffAmount)}
        >
          <DetailGrid>
            {renderField('Financing Amount', d.financingAmount, { isCurrency: true, emerald: true })}
            {renderField('Outstanding', d.outstanding, { isCurrency: true })}
            {renderField('Pay Off Amount', d.payOffAmount, { isCurrency: true })}
          </DetailGrid>
        </DetailSection>

        <DetailSection
          title="Rates & Instalments"
          icon={<Percent size={13} />}
          hidden={allEmpty(d.originalRate, d.currentRate, d.monthlyInstallment)}
        >
          <DetailGrid>
            {renderField('Original Rate', d.originalRate)}
            {renderField('Current Rate', d.currentRate)}
            {renderField('Monthly Instalment', d.monthlyInstallment, { isCurrency: true })}
          </DetailGrid>
        </DetailSection>

        {(d.vehicleModel || d.propertyType || d.propertyValuePrice || d.propertyAddress) && (
          <DetailSection title="Collateral Details" icon={<Building size={13} />}>
            <DetailGrid>
              {renderField('Vehicle Model', d.vehicleModel)}
              {renderField('Property Type', d.propertyType)}
              {renderField('Property Value Price', d.propertyValuePrice, { isCurrency: true })}
              {renderField('Property Address', d.propertyAddress, { fullWidth: true })}
            </DetailGrid>
          </DetailSection>
        )}
      </>
    );
  };

  const renderWm = () => {
    if (!d) return null;
    return (
      <>
        <DetailSection
          title="Policy & Plan Information"
          icon={<FileText size={13} />}
          hidden={allEmpty(d.policyNo || d.accountNo || d.accountNumber, d.planName, d.providerName, d.productDescription)}
        >
          <DetailGrid>
            {renderField('Policy Number', d.policyNo || d.accountNo || d.accountNumber, { mono: true, copyKey: 'policyNo' })}
            {renderField('Plan Name', d.planName, { bold: true })}
            {renderField('Provider Name', d.providerName)}
            {renderField('Product Description', d.productDescription, { fullWidth: true })}
          </DetailGrid>
        </DetailSection>

        <DetailSection title="Contribution & Status" icon={<DollarSign size={13} />}>
          <DetailGrid>
            {renderField('Basic Contribution Amount', d.basicContributionAmount, { isCurrency: true, emerald: true })}
            {renderField('Payment Mode', d.paymentMode)}
            <DetailField label="Certificate Status">
              <StatusBadge status={d.certificateStatus || d.certStatus} dot />
            </DetailField>
          </DetailGrid>
        </DetailSection>

        <DetailSection
          title="Important Dates"
          icon={<Calendar size={13} />}
          hidden={allEmpty(d.commencementDate, d.expiryDate)}
        >
          <DetailGrid>
            {renderField('Commencement Date', d.commencementDate)}
            {renderField('Expiry Date', d.expiryDate)}
          </DetailGrid>
        </DetailSection>
      </>
    );
  };

  return (
    <Drawer
      open={modalOpen}
      onClose={closeProductModal}
      closeLabel="Close product details"
      title={productName}
      subtitle={`${categoryName}${accountNoStr ? ` • Account ${accountNoStr}` : ''}`}
      icon={getCategoryIcon(productType)}
      footer={
        <div className={styles.footerSpread}>
          <div className={styles.footerMeta}>
            <span className={styles.footerAccountId}>
              Account: {accountNoStr || EMPTY_VALUE}
            </span>
            {accountNoStr && (
              <button
                type="button"
                onClick={() => handleCopyText('footerAcc', accountNoStr)}
                className={`${styles.footerCopyBtn}${copiedKey === 'footerAcc' ? ` ${styles.footerCopyBtnCopied}` : ''}`}
                title="Copy Account Number"
              >
                {copiedKey === 'footerAcc' ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedKey === 'footerAcc' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={closeProductModal}>
            Close Details
          </Button>
        </div>
      }
    >
      <div>
        {loadingDetails ? (
          <div>
            <div className={styles.skeletonCard}>
              <div className={styles.skeletonLine} style={{ width: '45%', height: '22px' }} />
              <div className={styles.skeletonLine} style={{ width: '65%', height: '14px' }} />
              <div className={styles.skeletonLine} style={{ width: '35%', height: '14px' }} />
            </div>
            <div className={styles.kpiGrid}>
              <div className={styles.skeletonCard}><div className={styles.skeletonLine} /></div>
              <div className={styles.skeletonCard}><div className={styles.skeletonLine} /></div>
              <div className={styles.skeletonCard}><div className={styles.skeletonLine} /></div>
            </div>
            <div className={styles.skeletonCard}>
              <div className={styles.skeletonLine} style={{ width: '30%', height: '16px' }} />
              <div className={styles.skeletonLine} style={{ width: '90%', height: '14px' }} />
              <div className={styles.skeletonLine} style={{ width: '80%', height: '14px' }} />
            </div>
          </div>
        ) : selectedProductDetails ? (
          <>
            {/* Hero Identity Overview Card */}
            <div className={styles.heroCard}>
              <div className={styles.heroLeft}>
                <div className={`${styles.heroAvatar} ${getAvatarStyle(productType)}`}>
                  {getCategoryIcon(productType, 24)}
                </div>
                <div className={styles.heroMeta}>
                  <h3 className={styles.heroTitle}>{productName}</h3>
                  <div className={styles.heroTags}>
                    {statusStr && <StatusBadge status={statusStr} dot />}
                    <Badge tone="primary">{categoryName}</Badge>
                    {accountNoStr && (
                      <span className={styles.accountPill}>
                        <Hash size={11} />
                        {accountNoStr}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick 3-Metric KPI Highlights Strip */}
            <div className={styles.kpiGrid}>
              <div className={styles.kpiCard}>
                <div className={`${styles.kpiIconBox} ${styles.kpiTileSuccess}`}>
                  <DollarSign size={17} />
                </div>
                <div className={styles.kpiBody}>
                  <span className={styles.kpiLabel}>{amountLabel}</span>
                  <span className={`${styles.kpiValue} ${styles.kpiValueSuccess}`}>
                    {primaryAmount}
                  </span>
                </div>
              </div>

              <div className={styles.kpiCard}>
                <div className={`${styles.kpiIconBox} ${styles.kpiTilePrimary}`}>
                  <CheckCircle2 size={17} />
                </div>
                <div className={styles.kpiBody}>
                  <span className={styles.kpiLabel}>Account Status</span>
                  <div className={styles.kpiValue}>
                    {statusStr ? <StatusBadge status={statusStr} dot /> : EMPTY_VALUE}
                  </div>
                </div>
              </div>

              <div className={styles.kpiCard}>
                <div className={`${styles.kpiIconBox} ${styles.kpiTileAmber}`}>
                  <Calendar size={17} />
                </div>
                <div className={styles.kpiBody}>
                  <span className={styles.kpiLabel}>{tenureLabel}</span>
                  <span className={styles.kpiValue}>
                    {tenureValue}
                  </span>
                </div>
              </div>
            </div>

            {/* Categorized Detailed Sections */}
            {isCorp ? (
              renderCorporateSections()
            ) : productType === 'wm' ? (
              renderWm()
            ) : (
              renderIndividualSections()
            )}
          </>
        ) : (
          <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
            <FileText size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <p>Could not load product details.</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
