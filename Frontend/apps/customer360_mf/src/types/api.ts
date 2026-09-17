// ---------------------------------------------------------------------------
// Domain types for the Customer 360 CRM API.
//
// These mirror backend/Models/Models.cs field-for-field (translated from the
// backend's PascalCase C# properties to the camelCase JSON keys it actually
// serializes — see backend/Data/DualNamingConverter.cs). Every CRM field is
// nullable/optional here because the CRM contract treats a missing field as
// legitimate, not exceptional (see frontend's formatValue() convention of
// rendering '-' for it) — nothing here should be widened to a non-optional
// type just because a sample response happened to include it.
//
// This file intentionally defines DATA SHAPES ONLY, not any request/response
// envelope helper types (those live next to services/api.ts, which is what
// actually consumes these).
// ---------------------------------------------------------------------------

/** GET /v1/indprofile — backend/Models/Models.cs: IndividualProfile */
export interface IndividualProfile {
  phprId: string;
  salutation?: string | null;
  fullName?: string | null;
  gender?: string | null;
  birthDate?: string | null;
  citizenship?: string | null;
  placeBirth?: string | null;
  /** Marital status (e.g. "SINGLE") — CRM's own field is literally named STATUS */
  status?: string | null;
  nationalId?: string | null;
  birthCertificate?: string | null;
  oldId?: string | null;
  policeNumber?: string | null;
  passport?: string | null;
  openingDate?: string | null;
  languagePreferred?: string | null;
  branchCode?: string | null;
  branch?: string | null;
  jobStatus?: string | null;
  occupation?: string | null;
  designation?: string | null;
  employerName?: string | null;
  employerPhone?: string | null;
  employerAddress?: string | null;
  pdpaTag?: string | null;
  race?: string | null;
  religion?: string | null;
  bumiStatus?: string | null;
  educationLevel?: string | null;
  hnwi?: string | null;
  pep?: string | null;
  annualIncome?: string | null;
  payrollInd?: string | null;
  mybsnInd?: string | null;
  lastModDate?: string | null;
  turnedNonResidentDate?: string | null;
  disabilityStatus?: string | null;
  industry?: string | null;
  employerEmail?: string | null;
  preferComChnl?: string | null;
  marketMessageOpt?: string | null;
  serviceMessage?: string | null;
  interestedProduct?: string | null;
  interestedProductName?: string | null;
  interestedProductCategory?: string | null;
  refEmployeeName?: string | null;
  refEmployeeEmail?: string | null;
  crgDetails?: string | null;
  rmName?: string | null;
  rmId?: string | null;
  rmBranchCode?: string | null;
  rmContactNo?: string | null;
  profilePic?: string | null;
  segmentation?: string | null;
  lastContactDate?: string | null;
  prevCustomerInter?: string | null;
  currentRm?: string | null;
  lastContactDateRm?: string | null;
  /** Customer status/lifecycle indicator (e.g. "ACTIVE") — not a "customer type" */
  flags?: string | null;
  employmentReligion?: string | null;
  employmentBumiStatus?: string | null;
  campaignCode?: string | null;
  positionDate?: string | null;
  resdCode?: string | null;
  vulnerability?: string | null;
  engagementCount?: string | null;
  eligibilityScore?: string | null;
  refEmployeeId?: string | null;
}

/** GET /v1/corpprofile — backend/Models/Models.cs: CorporateProfile */
export interface CorporateProfile {
  customerId: string;
  cifNumber?: string | null;
  salutation?: string | null;
  segmentation?: string | null;
  organizationName?: string | null;
  businessRegDate?: string | null;
  country?: string | null;
  organizationType?: string | null;
  economicSector?: string | null;
  residentType?: string | null;
  brn?: string | null;
  brn2?: string | null;
  lastModifyDate?: string | null;
  onlineBankingRegistrationStatus?: string | null;
  onlineBankingActivationStatus?: string | null;
  residentAddress?: string | null;
  tin?: string | null;
  annualIncome?: string | null;
  signatoryName?: string | null;
  signatorySalutation?: string | null;
  companyWebsite?: string | null;
  payrollIndic?: string | null;
  marketMessageOpt?: string | null;
  serviceMessage?: string | null;
  interestedProduct?: string | null;
  interestedProductName?: string | null;
  interestedProductCategory?: string | null;
  campaignEligibleA?: string | null;
  campaignEligibleB?: string | null;
  lastContactDate?: string | null;
  /** Corporate customer status/lifecycle indicator (e.g. "ACTIVE") */
  lifecycleTrig?: string | null;
  refEmployeeName?: string | null;
  refEmployeeEmail?: string | null;
  refEmployeePhoneNo?: string | null;
  refStaffId?: string | null;
  rmName?: string | null;
  rmId?: string | null;
  rmBranchCode?: string | null;
  rmContactNo?: string | null;
  profilePic?: string | null;
  positionDate?: string | null;
  openingDate?: string | null;
  signatoryDateOfBirth?: string | null;
  signatoryIdNumber?: string | null;
  signatoryPhoneNumber?: string | null;
  signatoryPosition?: string | null;
  engagementCount?: string | null;
  eligibilityScore?: string | null;
}

export type CustomerProfile = IndividualProfile | CorporateProfile;

/** GET /v1/contactinfo — backend/Models/Models.cs: ContactDetail */
export interface ContactDetail {
  partyId: string;
  fixedAddress?: string | null;
  mailingAddress?: string | null;
  padrEmail1?: string | null;
  padrEmail2?: string | null;
  contactNumber?: string | null;
  nricBrn?: string | null;
  padrLastModDate?: string | null;
  type?: string | null;
  positionDate?: string | null;
}

/** One row of GET /v1/customerproduct's `data` array — backend/Models/Models.cs: CustomerProduct */
export interface CustomerProduct {
  accountNumber: string;
  partyId?: string | null;
  phprId?: string | null;
  type?: string | null;
  productCategory?: string | null;
  productName?: string | null;
  tenure?: string | null;
  maturityDate?: string | null;
  derivedAccountStatus?: string | null;
  financingStatus?: string | null;
  cardStatus?: string | null;
  certStatus?: string | null;
  goldStatus?: string | null;
  balances?: string | null;
  outstanding?: string | null;
  cardType?: string | null;
  campaignCode?: string | null;
  lastContactDate?: string | null;
  accountOpeningDate?: string | null;
  cardIssuanceDate?: string | null;
  createdDate?: string | null;
  commencementDate?: string | null;
  disbursedDate?: string | null;
  tarikhDaftarWasiat?: string | null;
}

/** GET /v1/interactions/{id} — backend/Models/Models.cs: Interaction */
export interface Interaction {
  caseId: string;
  partyId?: string | null;
  positionDate?: string | null;
  dateComplaint?: string | null;
  dateCase?: string | null;
  classification?: string | null;
  main?: string | null;
  category?: string | null;
  subCategory1?: string | null;
  subCategory2?: string | null;
  statusParent?: string | null;
  statusChild?: string | null;
  amountInvolved?: string | null;
  nric?: string | null;
  sourceName?: string | null;
  stateName?: string | null;
  channelToSubRoleId?: string | null;
  subRoleName?: string | null;
  requireEscalation?: string | null;
  createdByParent?: string | null;
  createdDateParent?: string | null;
  modifiedByParent?: string | null;
  createdByChild?: string | null;
  createdDateChild?: string | null;
  modifiedByChild?: string | null;
  branchName?: string | null;
  branchHqName?: string | null;
  rootNotes?: string | null;
  actionSummary?: string | null;
  actionDetails?: string | null;
  description?: string | null;
  newAccNo?: string | null;
  oldAccNo?: string | null;
  customerName?: string | null;
  contactNo?: string | null;
  channelTo?: string | null;
  calendarDays?: string | null;
  businessDays?: string | null;
  bnmName?: string | null;
  mofName?: string | null;
  closedDate?: string | null;
  cusBranchHqName?: string | null;
  cusBranchName?: string | null;
  cusRoleId?: string | null;
}

/** GET /v1/product/deposit — backend/Models/Models.cs: DepositProduct */
export interface DepositProduct {
  accountNumber: string;
  positionDate?: string | null;
  productCode?: string | null;
  productCategory?: string | null;
  productName?: string | null;
  productDescription?: string | null;
  derivedAccountStatus?: string | null;
  balances?: string | null;
  blockingReasons?: string | null;
  accountOpeningDate?: string | null;
  accountPurposes?: string | null;
  branchAccount?: string | null;
  stateAccount?: string | null;
  placementAmount?: string | null;
  maturityDate?: string | null;
  hsmmRates?: string | null;
  maturityInstruction?: string | null;
  tenure?: string | null;
  creditingCasaAccountNo?: string | null;
  rnCerd?: string | null;
  cerdPurchaseDate?: string | null;
  cerdSerialNo?: string | null;
  cerdFromCertNum?: string | null;
  cerdToCertNum?: string | null;
  cerdNoOfUnits?: string | null;
  customerName?: string | null;
  phprId?: string | null;
  custId?: string | null;
  lastTransactionDate?: string | null;
  oldAccountNo?: string | null;
}

/** GET /v1/product/loan — backend/Models/Models.cs: LoanProduct */
export interface LoanProduct {
  accountNo: string;
  positionDate?: string | null;
  productCategory?: string | null;
  productName?: string | null;
  productDescription?: string | null;
  financingStatus?: string | null;
  outstanding?: string | null;
  financingAmount?: string | null;
  monthlyInstallment?: string | null;
  originalRate?: string | null;
  currentRate?: string | null;
  tenure?: string | null;
  maturityDate?: string | null;
  disbursedDate?: string | null;
  vehicleModel?: string | null;
  propertyType?: string | null;
  propertyValuePrice?: string | null;
  propertyAddress?: string | null;
  phprId?: string | null;
  mrprId?: string | null;
  custId?: string | null;
  ilomSeq?: string | null;
  payOffAmount?: string | null;
  titleNo?: string | null;
}

/** GET /v1/product/cards — backend/Models/Models.cs: CardsProduct */
export interface CardsProduct {
  accountNo: string;
  positionDate?: string | null;
  cardType?: string | null;
  cardTypeDesc?: string | null;
  acctBrch?: string | null;
  productCode?: string | null;
  productName?: string | null;
  creditLimit?: string | null;
  outstanding?: string | null;
  currentDue?: string | null;
  cardStatus?: string | null;
  profitInterestRate?: string | null;
  cardIssuanceDate?: string | null;
  cardExpiredDate?: string | null;
  acctBlk?: string | null;
  cardBlk?: string | null;
  cardBlkDate?: string | null;
  nric?: string | null;
  custName?: string | null;
  instalmentPlansTag?: string | null;
  lastPaymentDate?: string | null;
  cardNo?: string | null;
  originalRate?: string | null;
  currentRate?: string | null;
  payOffAmount?: string | null;
  brn?: string | null;
  productCategory?: string | null;
  /** Only populated for a debit card (CARD TYPE = "DE"); null for every other card type by design */
  casaBalance?: string | null;
}

/** GET /v1/product/gold — backend/Models/Models.cs: GoldProduct */
export interface GoldProduct {
  goldAccountNo: string;
  positionDate?: string | null;
  accountType?: string | null;
  createdDate?: string | null;
  status?: string | null;
  xauBalance?: string | null;
  totalAmount?: string | null;
  bankBuySell?: string | null;
  customerName?: string | null;
  primaryIdNo?: string | null;
}

/** GET /v1/product/wm — backend/Models/Models.cs: WmProduct */
export interface WmProduct {
  policyNo: string;
  positionDate?: string | null;
  productCategory?: string | null;
  providerName?: string | null;
  planName?: string | null;
  autoRenewal?: string | null;
  basicContributionAmount?: string | null;
  commencementDate?: string | null;
  certificateStatus?: string | null;
  customerName?: string | null;
  primaryIdNumber?: string | null;
  paymentMode?: string | null;
  expiryDate?: string | null;
  vehicleNo?: string | null;
  productDescription?: string | null;
}

/** GET /v1/product/unittrust — backend/Models/Models.cs: UnitTrustProduct */
export interface UnitTrustProduct {
  investmentAccountNo: string;
  positionDate?: string | null;
  fundName?: string | null;
  unitHoldings?: string | null;
  nric?: string | null;
  customerName?: string | null;
}

/** GET /v1/product/willwriting — backend/Models/Models.cs: WillWritingProduct */
export interface WillWritingProduct {
  willWritingRefNo: string;
  positionDate?: string | null;
  nric?: string | null;
  customerName?: string | null;
  productName?: string | null;
  tarikhDaftarWasiat?: string | null;
}

/** Union of every possible openProductModal() result — see productStore.ts */
export type ProductDetail =
  | DepositProduct
  | LoanProduct
  | CardsProduct
  | GoldProduct
  | WmProduct
  | UnitTrustProduct
  | WillWritingProduct;

/**
 * The rendered shape of `selectedProductDetails` once `openProductModal`
 * merges the Product Held row (`CustomerProduct`) with whichever
 * product-detail endpoint response actually came back (`ProductDetail`).
 * Which fields are actually populated is only known at runtime (decided by
 * `detectProductType`'s string-matching against the CRM's own type/category
 * text) — this intersection-of-partials describes that honestly, rather
 * than picking one member of the union and pretending the others' fields
 * don't get accessed. Used by ProductDetailsModal, which renders a
 * different subset of these fields per detected product type.
 */
export type AnyProductFields = Partial<DepositProduct> &
  Partial<LoanProduct> &
  Partial<CardsProduct> &
  Partial<GoldProduct> &
  Partial<WmProduct> &
  Partial<UnitTrustProduct> &
  Partial<WillWritingProduct> &
  Partial<CustomerProduct>;

export type ProductDetailType = 'loan' | 'deposit' | 'card' | 'gold' | 'wm' | 'unittrust' | 'willwriting';

/** `{ value, label }` option shape returned by GET /v1/lookups */
export interface LookupOption {
  value: string;
  label: string;
}

export interface LookupOptions {
  idTypes: LookupOption[];
  secondaryIdTypes: LookupOption[];
  corpSearchTypes: LookupOption[];
}

/** 'individual' | 'corporate' — the Zustand store's own customerType, not a CRM field */
export type CustomerType = 'individual' | 'corporate';

export interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  description: string;
  status: string;
  customerName?: string;
  customerType?: string;
  customerId?: string;
  field?: string;
}

/** Mirrors Backend/Customer360Service/Models/FieldConfig.cs's ProfileType exactly. */
export type FieldConfigProfileType = 'Individual' | 'Corporate';

/** Mirrors Backend/Customer360Service/Models/FieldConfig.cs's MaskingRule exactly. */
export type MaskingRule =
  | 'None'
  | 'HideFirstShowLast'
  | 'HideLastShowFirst'
  | 'HideMiddleShowFirstAndLast'
  | 'FullMask';

/**
 * One row of GET/PUT /v1/field-config/{individual|corporate} — the admin-configurable rule the
 * Customer 360 detail pages render a single profile field from. See FieldConfig.cs for the
 * authoritative field-by-field documentation (in particular what the "contact." ApiField prefix
 * means).
 */
export interface FieldConfig {
  id: string;
  profileType: FieldConfigProfileType;
  apiField: string;
  displayLabel: string;
  visible: boolean;
  section: string;
  displayOrder: number;
  sensitive: boolean;
  maskingRule: MaskingRule;
  visibleCharCount: number;
}

/**
 * Returned in `data` (HTTP 202) instead of the real field-config list whenever the PUT was gated by
 * Maker-Checker approval and could not be applied directly — the "fieldsettings" module has a checker
 * assigned. Mirrors AuthService's own ApprovalPendingDto shape; Module Federation isolation means this
 * can't be imported from the host, so it's a local structural copy.
 */
export interface ApprovalPendingDto {
  approvalRequestId: string;
  module: string;
  action: string;
  checkerName: string;
  message: string;
}

export function isApprovalPending(value: unknown): value is ApprovalPendingDto {
  return typeof value === 'object' && value !== null && 'approvalRequestId' in value;
}
