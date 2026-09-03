import React, { type ReactNode } from 'react';
import { useProductStore } from '../store/productStore';
import { useCustomerStore } from '../store/customerStore';
import { Landmark, FileText, DollarSign, Percent, CreditCard, Coins, TrendingUp, ScrollText, Calendar } from '@omniremit/ui/icons';
import type { AnyProductFields, ProductDetailType, CorporateProfile } from '../types/api';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney } from '../shared/formatValue';
import { Drawer } from '@omniremit/ui';

// ---------------------------------------------------------------------------
// Product type detection — mirrors the routing logic in productStore.ts
// (openProductModal) so the drawer always renders the fields that actually
// belong to the product that was fetched, instead of assuming every product
// is a Loan.
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

/** Shared label/value cell for the `.drawer-grid` layout — used by this drawer and reused as-is by
 * other drawers (e.g. Audit Log Details) that want the same card-based section structure. */
export const Field = ({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) => (
  <div className="drawer-field" style={span ? { gridColumn: 'span 2' } : undefined}>
    <span className="info-label">{label}</span>
    <span className="info-value">{children}</span>
  </div>
);

export default function ProductDetailsModal() {
  const { selectedProductDetails, modalOpen, loadingDetails, closeProductModal } = useProductStore();
  const { customerType, profile } = useCustomerStore();
  const isCorp = customerType === 'corporate';
  // `country` only exists on the corporate profile shape — this modal is
  // shared by both flows, and formatCurrency/the WM contribution field use
  // it the same way regardless of customer type (undefined for Individual,
  // same as before this file was typed).
  const profileCountry = (profile as CorporateProfile | null)?.country;

  // formatValue/formatCurrency now come from src/shared — they were duplicated verbatim in
  // four components. Currency is bound to this modal's profile country once, here.
  const formatCurrency = (val: unknown) => formatMoney(val, profileCountry);

  if (!modalOpen) return null;

  const d = selectedProductDetails as AnyProductFields | null;
  const productType = detectProductType(d);

  // ---------------------------------------------------------------------------
  // Row helper for the flat-list (Corporate) visual style.
  // ---------------------------------------------------------------------------
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="drawer-field">
      <span className="info-label">{label}</span>
      <span className="info-value">{children}</span>
    </div>
  );

  const renderCorpFlatList = () => {
    if (!d) return null;

    if (productType === 'deposit') {
      return (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <Landmark size={16} />
              <span>Financing & Account Information</span>
            </div>
            <div className="drawer-grid">
              <Field label="Position Date">{formatValue(d.positionDate)}</Field>
              <Field label="Product Category">{formatValue(d.productCategory)}</Field>
              <Field label="Product Name">{formatValue(d.productName)}</Field>
              <Field label="Account Number">{formatValue(d.accountNumber || d.accountNo)}</Field>
              <Field label="Account Status">
                <StatusBadge status={d.derivedAccountStatus} />
              </Field>
              <Field label="Balances">{formatCurrency(d.balances)}</Field>
              <Field label="Placement Amount">{formatCurrency(d.placementAmount)}</Field>
              <Field label="Tenure">{formatValue(d.tenure)}</Field>
              <Field label="Branch Account">{formatValue(d.branchAccount)}</Field>
              <Field label="State Account">{formatValue(d.stateAccount)}</Field>
              <Field label="HSMM Rates">{formatValue(d.hsmmRates)}</Field>
              <Field label="Maturity Instruction">{formatValue(d.maturityInstruction)}</Field>
              <Field label="Crediting CASA Account No">{formatValue(d.creditingCasaAccountNo)}</Field>
              <Field label="Blocking Reasons">{formatValue(d.blockingReasons)}</Field>
              <Field label="PHPR ID">{formatValue(d.phprId)}</Field>
              <Field label="Cust ID">{formatValue(d.custId)}</Field>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <Calendar size={16} />
              <span>Important Dates</span>
            </div>
            <div className="drawer-grid">
              <Field label="Account Opening Date">{formatValue(d.accountOpeningDate)}</Field>
              <Field label="Maturity Date">{formatValue(d.maturityDate)}</Field>
            </div>
          </div>
        </>
      );
    }

    if (productType === 'card') {
      return (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <CreditCard size={16} />
              <span>Financing & Account Information</span>
            </div>
            <div className="drawer-grid">
              <Field label="Position Date">{formatValue(d.positionDate)}</Field>
              <Field label="Card Type">{formatValue(d.cardTypeDesc || d.cardType)}</Field>
              <Field label="Product Name">{formatValue(d.productName)}</Field>
              <Field label="Account No">{formatValue(d.accountNo || d.accountNumber)}</Field>
              <Field label="Card No">{formatValue(d.cardNo)}</Field>
              <Field label="Card Status">
                <StatusBadge status={d.cardStatus} />
              </Field>
              <Field label="Credit Limit">{formatCurrency(d.creditLimit)}</Field>
              <Field label="Outstanding">{formatCurrency(d.outstanding)}</Field>
              <Field label="Current Due">{formatCurrency(d.currentDue)}</Field>
              <Field label="Profit Interest Rate">{formatValue(d.profitInterestRate)}</Field>
              <Field label="Original Rate">{formatValue(d.originalRate)}</Field>
              <Field label="Current Rate">{formatValue(d.currentRate)}</Field>
              <Field label="Pay Off Amount">{formatCurrency(d.payOffAmount)}</Field>
              <Field label="BRN">{formatValue(d.brn)}</Field>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <Calendar size={16} />
              <span>Important Dates</span>
            </div>
            <div className="drawer-grid">
              <Field label="Card Issuance Date">{formatValue(d.cardIssuanceDate)}</Field>
              <Field label="Card Expired Date">{formatValue(d.cardExpiredDate)}</Field>
            </div>
          </div>
        </>
      );
    }

    // Default: Loan / Financing
    return (
      <>
        <div className="drawer-section">
          <div className="drawer-section-title">
            <FileText size={16} />
            <span>Financing & Account Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Position Date">{formatValue(d.positionDate)}</Field>
            <Field label="Product Category">{formatValue(d.productCategory)}</Field>
            <Field label="Product Name">{formatValue(d.productName)}</Field>
            <Field label="Account No">{formatValue(d.accountNo || d.accountNumber)}</Field>
            <Field label="Financing Status">
              <StatusBadge status={d.financingStatus || d.derivedAccountStatus} />
            </Field>
            <Field label="Outstanding">{formatCurrency(d.outstanding || d.balances)}</Field>
            <Field label="Financing Amount">{formatCurrency(d.financingAmount || d.placementAmount)}</Field>
            <Field label="Monthly Installment">{formatCurrency(d.monthlyInstallment)}</Field>
            <Field label="Original Rate">{formatValue(d.originalRate)}</Field>
            <Field label="Current Rate">{formatValue(d.currentRate || d.hsmmRates)}</Field>
            <Field label="Tenure">{formatValue(d.tenure)}</Field>
            <Field label="Pay Off Amount">{formatCurrency(d.payOffAmount)}</Field>
            <Field label="ILOM SEQ">{formatValue(d.ilomSeq)}</Field>
            <Field label="Title No">{formatValue(d.titleNo)}</Field>
            <Field label="PHPR ID">{formatValue(d.phprId)}</Field>
            <Field label="MRPR ID">{formatValue(d.mrprId)}</Field>
            <Field label="Cust ID">{formatValue(d.custId)}</Field>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <Calendar size={16} />
            <span>Important Dates</span>
          </div>
          <div className="drawer-grid">
            <Field label="Disbursed Date">{formatValue(d.disbursedDate || d.accountOpeningDate)}</Field>
            <Field label="Maturity Date">{formatValue(d.maturityDate)}</Field>
          </div>
        </div>

        {(d.vehicleModel || d.propertyType || d.propertyValuePrice || d.propertyAddress) ? (
          <div className="drawer-section">
            <div className="drawer-section-title">
              <FileText size={16} />
              <span>Collateral Details</span>
            </div>
            <div className="drawer-grid">
              <Field label="Vehicle Model">{formatValue(d.vehicleModel)}</Field>
              <Field label="Property Type">{formatValue(d.propertyType)}</Field>
              <Field label="Property Value Price">{formatCurrency(d.propertyValuePrice)}</Field>
              <Field label="Property Address" span>{formatValue(d.propertyAddress)}</Field>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderIndividualSections = () => {
    if (!d) return null;

    if (productType === 'card') {
      return (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <CreditCard size={16} />
              <span>Card Information</span>
            </div>
            <div className="drawer-grid">
              <Field label="Card No">{formatValue(d.cardNo)}</Field>
              <Field label="Card Type">{formatValue(d.cardTypeDesc || d.cardType)}</Field>
              <Field label="Account No">
                <span className="account-num-text">{formatValue(d.accountNo || d.accountNumber)}</span>
              </Field>
              <Field label="Card Status">
                <StatusBadge status={d.cardStatus} />
              </Field>
              <Field label="Card Issuance Date">{formatValue(d.cardIssuanceDate)}</Field>
              <Field label="Card Expiry Date">{formatValue(d.cardExpiredDate)}</Field>
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <DollarSign size={16} />
              <span>Balances & Rates</span>
            </div>
            <div className="drawer-grid">
              <Field label="Credit Limit">{formatCurrency(d.creditLimit)}</Field>
              <Field label="Outstanding">{formatCurrency(d.outstanding)}</Field>
              <Field label="Current Due">{formatCurrency(d.currentDue)}</Field>
              <Field label="Pay Off Amount">{formatCurrency(d.payOffAmount)}</Field>
              <Field label="Profit Interest Rate">{formatValue(d.profitInterestRate)}</Field>
              <Field label="Current Rate">{formatValue(d.currentRate)}</Field>
              {d.casaBalance ? <Field label="CASA Balance">{formatCurrency(d.casaBalance)}</Field> : null}
            </div>
          </div>
        </>
      );
    }

    if (productType === 'gold') {
      return (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <Coins size={16} />
            <span>Gold Account Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Gold Account No">
              <span className="account-num-text">{formatValue(d.goldAccountNo || d.accountNo || d.accountNumber)}</span>
            </Field>
            <Field label="Account Type">{formatValue(d.accountType)}</Field>
            <Field label="Status">
              <StatusBadge status={d.status} />
            </Field>
            <Field label="XAU Balance (Gram)">{formatValue(d.xauBalance)}</Field>
            <Field label="Total Amount (RM)">{formatCurrency(d.totalAmount)}</Field>
            <Field label="Bank Buy/Sell">{formatValue(d.bankBuySell)}</Field>
            <Field label="Created Date">{formatValue(d.createdDate)}</Field>
          </div>
        </div>
      );
    }

    if (productType === 'unittrust') {
      return (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <TrendingUp size={16} />
            <span>Unit Trust Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Investment Account No">
              <span className="account-num-text">
                {formatValue(d.investmentAccountNo || d.accountNo || d.accountNumber)}
              </span>
            </Field>
            <Field label="Fund Name" span>
              {formatValue(d.fundName)}
            </Field>
            <Field label="Unit Holdings">{formatValue(d.unitHoldings)}</Field>
            <Field label="Position Date">{formatValue(d.positionDate)}</Field>
          </div>
        </div>
      );
    }

    if (productType === 'willwriting') {
      return (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <ScrollText size={16} />
            <span>Will Writing Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Will Writing Ref No">
              <span className="account-num-text">
                {formatValue(d.willWritingRefNo || d.accountNo || d.accountNumber)}
              </span>
            </Field>
            <Field label="Product Name" span>
              {formatValue(d.productName)}
            </Field>
            <Field label="Registration Date (Tarikh Daftar Wasiat)">{formatValue(d.tarikhDaftarWasiat)}</Field>
            <Field label="Position Date">{formatValue(d.positionDate)}</Field>
          </div>
        </div>
      );
    }

    if (productType === 'deposit') {
      return (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <FileText size={16} />
              <span>Account Information</span>
            </div>
            <div className="drawer-grid">
              <Field label="Account No">
                <span className="account-num-text">{formatValue(d.accountNumber || d.accountNo)}</span>
              </Field>
              <Field label="Account Status">
                <StatusBadge status={d.derivedAccountStatus} />
              </Field>
              <Field label="Tenure">{formatValue(d.tenure)}</Field>
              <Field label="Maturity Date">{formatValue(d.maturityDate)}</Field>
              <Field label="Branch Account">{formatValue(d.branchAccount)}</Field>
              <Field label="Account Opening Date">{formatValue(d.accountOpeningDate)}</Field>
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <DollarSign size={16} />
              <span>Balances & Rates</span>
            </div>
            <div className="drawer-grid">
              <Field label="Balances">{formatCurrency(d.balances)}</Field>
              <Field label="Placement Amount">{formatCurrency(d.placementAmount)}</Field>
              <Field label="HSMM Rates">{formatValue(d.hsmmRates)}</Field>
              <Field label="Maturity Instruction">{formatValue(d.maturityInstruction)}</Field>
            </div>
          </div>
        </>
      );
    }

    // Loan (default individual shape)
    return (
      <>
        <div className="drawer-section">
          <div className="drawer-section-title">
            <FileText size={16} />
            <span>Account Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Account No">
              <span className="account-num-text">{formatValue(d.accountNo || d.accountNumber)}</span>
            </Field>
            <Field label="Financing Status">
              <StatusBadge status={d.financingStatus} />
            </Field>
            <Field label="Tenure (Months)">{formatValue(d.tenure)}</Field>
            <Field label="Maturity Date">{formatValue(d.maturityDate)}</Field>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <DollarSign size={16} />
            <span>Financing & Balances</span>
          </div>
          <div className="drawer-grid">
            <Field label="Financing Amount">{formatCurrency(d.financingAmount)}</Field>
            <Field label="Outstanding">{formatCurrency(d.outstanding)}</Field>
            <Field label="Pay Off Amount">{formatCurrency(d.payOffAmount)}</Field>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <Percent size={16} />
            <span>Rates & Instalments</span>
          </div>
          <div className="drawer-grid">
            <Field label="Original Rate">{formatValue(d.originalRate)}</Field>
            <Field label="Current Rate">{formatValue(d.currentRate)}</Field>
            <Field label="Monthly Instalment">{formatValue(d.monthlyInstallment)}</Field>
          </div>
        </div>

        {d.vehicleModel || d.propertyType || d.propertyValuePrice || d.propertyAddress ? (
          <div className="drawer-section">
            <div className="drawer-section-title">
              <FileText size={16} />
              <span>Collateral</span>
            </div>
            <div className="drawer-grid">
              <Field label="Vehicle Model">{formatValue(d.vehicleModel)}</Field>
              <Field label="Property Type">{formatValue(d.propertyType)}</Field>
              <Field label="Property Value Price">{formatCurrency(d.propertyValuePrice)}</Field>
              <Field label="Property Address" span>
                {formatValue(d.propertyAddress)}
              </Field>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const renderWm = () => {
    if (!d) return null;
    return (
      <>
        <div className="drawer-section">
          <div className="drawer-section-title">
            <FileText size={16} />
            <span>Account / Policy Information</span>
          </div>
          <div className="drawer-grid">
            <Field label="Policy Number">
              <span className="account-num-text">{formatValue(d.policyNo || d.accountNo || d.accountNumber)}</span>
            </Field>
            <Field label="Plan Name">{formatValue(d.planName)}</Field>
            <Field label="Provider Name">{formatValue(d.providerName)}</Field>
            <Field label="Product Description" span>
              {formatValue(d.productDescription)}
            </Field>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <DollarSign size={16} />
            <span>Contribution & Status</span>
          </div>
          <div className="drawer-grid">
            <Field label="Basic Contribution Amount">
              {d.basicContributionAmount
                ? `${(profileCountry || '').toUpperCase() === 'SG' ? 'SGD' : 'MYR'} ${d.basicContributionAmount}`
                : '-'}
            </Field>
            <Field label="Payment Mode">{formatValue(d.paymentMode)}</Field>
            <Field label="Certificate Status">
              <StatusBadge status={d.certificateStatus} />
            </Field>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <Percent size={16} />
            <span>Important Dates</span>
          </div>
          <div className="drawer-grid">
            <Field label="Commencement Date">{formatValue(d.commencementDate)}</Field>
            <Field label="Expiry Date">{formatValue(d.expiryDate)}</Field>
          </div>
        </div>
      </>
    );
  };

  return (
    <Drawer
      open={modalOpen}
      onClose={closeProductModal}
      title="Product Details"
      subtitle="Complete Product Information"
      icon={<Landmark size={20} />}
    >
      <div className="drawer-body">
          {loadingDetails ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <span>Fetching details from server...</span>
            </div>
          ) : selectedProductDetails ? (
            isCorp ? (
              renderCorpFlatList()
            ) : productType === 'wm' ? (
              renderWm()
            ) : (
              renderIndividualSections()
            )
          ) : (
            <div className="empty-state">
              <span>Could not load product details.</span>
            </div>
          )}
      </div>
    </Drawer>
  );
}
