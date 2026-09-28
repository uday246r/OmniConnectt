using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    [Table("individual_profiles")]
    public class IndividualProfile
    {
        [Key]
        [Column("phpr_id")]
        public string PhprId { get; set; } = string.Empty;

        [Column("salutation")]
        public string? Salutation { get; set; }

        [Column("full_name")]
        public string? FullName { get; set; }

        [Column("gender")]
        public string? Gender { get; set; }

        [Column("birth_date")]
        public string? BirthDate { get; set; }

        [Column("citizenship")]
        public string? Citizenship { get; set; }

        [Column("place_birth")]
        public string? PlaceBirth { get; set; }

        [Column("status")]
        public string? Status { get; set; }

        [Column("national_id")]
        public string? NationalId { get; set; }

        [Column("birth_certificate")]
        public string? BirthCertificate { get; set; }

        [Column("old_id")]
        public string? OldId { get; set; }

        [Column("police_number")]
        public string? PoliceNumber { get; set; }

        [Column("passport")]
        public string? Passport { get; set; }

        [Column("opening_date")]
        public string? OpeningDate { get; set; }

        [Column("language_preferred")]
        public string? LanguagePreferred { get; set; }

        [Column("branch_code")]
        public string? BranchCode { get; set; }

        [Column("branch")]
        public string? Branch { get; set; }

        [Column("job_status")]
        public string? JobStatus { get; set; }

        [Column("occupation")]
        public string? Occupation { get; set; }

        [Column("designation")]
        public string? Designation { get; set; }

        [Column("employer_name")]
        public string? EmployerName { get; set; }

        [Column("employer_phone")]
        public string? EmployerPhone { get; set; }

        [Column("employer_address")]
        public string? EmployerAddress { get; set; }

        [Column("pdpa_tag")]
        public string? PdpaTag { get; set; }

        [Column("race")]
        public string? Race { get; set; }

        [Column("religion")]
        public string? Religion { get; set; }

        [Column("bumi_status")]
        public string? BumiStatus { get; set; }

        [Column("education_level")]
        public string? EducationLevel { get; set; }

        [Column("hnwi")]
        public string? Hnwi { get; set; }

        [Column("pep")]
        public string? Pep { get; set; }

        [Column("annual_income")]
        public string? AnnualIncome { get; set; }

        [Column("payroll_ind")]
        public string? PayrollInd { get; set; }

        [Column("mybsn_ind")]
        public string? MybsnInd { get; set; }

        [Column("last_mod_date")]
        public string? LastModDate { get; set; }

        [Column("turned_non_resident_date")]
        public string? TurnedNonResidentDate { get; set; }

        [Column("disability_status")]
        public string? DisabilityStatus { get; set; }

        [Column("industry")]
        public string? Industry { get; set; }

        [Column("employer_email")]
        public string? EmployerEmail { get; set; }

        [Column("prefer_com_chnl")]
        public string? PreferComChnl { get; set; }

        [Column("market_message_opt")]
        public string? MarketMessageOpt { get; set; }

        [Column("service_message")]
        public string? ServiceMessage { get; set; }

        [Column("interested_product")]
        public string? InterestedProduct { get; set; }

        [Column("interested_product_name")]
        public string? InterestedProductName { get; set; }

        [Column("interested_product_category")]
        public string? InterestedProductCategory { get; set; }

        [Column("ref_employee_name")]
        public string? RefEmployeeName { get; set; }

        [Column("ref_employee_email")]
        public string? RefEmployeeEmail { get; set; }

        [Column("crg_details")]
        public string? CrgDetails { get; set; }

        [Column("rm_name")]
        public string? RmName { get; set; }

        [Column("rm_id")]
        public string? RmId { get; set; }

        [Column("rm_branch_code")]
        public string? RmBranchCode { get; set; }

        [Column("rm_contact_no")]
        public string? RmContactNo { get; set; }

        [Column("profile_pic")]
        public string? ProfilePic { get; set; }

        [Column("segmentation")]
        public string? Segmentation { get; set; }

        [Column("last_contact_date")]
        public string? LastContactDate { get; set; }

        [Column("prev_customer_inter")]
        public string? PrevCustomerInter { get; set; }

        [Column("current_rm")]
        public string? CurrentRm { get; set; }

        [Column("last_contact_date_rm")]
        public string? LastContactDateRm { get; set; }

        [Column("flags")]
        public string? Flags { get; set; }

        [Column("employment_religion")]
        public string? EmploymentReligion { get; set; }

        [Column("employment_bumi_status")]
        public string? EmploymentBumiStatus { get; set; }

        [Column("campaign_code")]
        public string? CampaignCode { get; set; }

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("resd_code")]
        public string? ResdCode { get; set; }

        [Column("vulnerability")]
        public string? Vulnerability { get; set; }

        [Column("engagement_count")]
        public string? EngagementCount { get; set; }

        [Column("eligibility_score")]
        public string? EligibilityScore { get; set; }

        [Column("ref_employee_id")]
        public string? RefEmployeeId { get; set; }
    }

    [Table("corporate_profiles")]
    public class CorporateProfile
    {
        [Key]
        [Column("customer_id")]
        public string CustomerId { get; set; } = string.Empty;

        [Column("cif_number")]
        public string? CifNumber { get; set; }

        [Column("salutation")]
        public string? Salutation { get; set; }

        [Column("segmentation")]
        public string? Segmentation { get; set; }

        [Column("organization_name")]
        public string? OrganizationName { get; set; }

        [Column("business_reg_date")]
        public string? BusinessRegDate { get; set; }

        [Column("country")]
        public string? Country { get; set; }

        [Column("organization_type")]
        public string? OrganizationType { get; set; }

        [Column("economic_sector")]
        public string? EconomicSector { get; set; }

        [Column("resident_type")]
        public string? ResidentType { get; set; }

        [Column("brn")]
        public string? Brn { get; set; }

        [Column("brn2")]
        public string? Brn2 { get; set; }

        [Column("last_modify_date")]
        public string? LastModifyDate { get; set; }

        [Column("online_banking_registration_status")]
        public string? OnlineBankingRegistrationStatus { get; set; }

        [Column("online_banking_activation_status")]
        public string? OnlineBankingActivationStatus { get; set; }

        [Column("resident_address")]
        public string? ResidentAddress { get; set; }

        [Column("tin")]
        public string? Tin { get; set; }

        [Column("annual_income")]
        public string? AnnualIncome { get; set; }

        [Column("signatory_name")]
        public string? SignatoryName { get; set; }

        [Column("signatory_salutation")]
        public string? SignatorySalutation { get; set; }

        [Column("company_website")]
        public string? CompanyWebsite { get; set; }

        [Column("payroll_indic")]
        public string? PayrollIndic { get; set; }

        [Column("market_message_opt")]
        public string? MarketMessageOpt { get; set; }

        [Column("service_message")]
        public string? ServiceMessage { get; set; }

        [Column("interested_product")]
        public string? InterestedProduct { get; set; }

        [Column("interested_product_name")]
        public string? InterestedProductName { get; set; }

        [Column("interested_product_category")]
        public string? InterestedProductCategory { get; set; }

        [Column("campaign_eligible_a")]
        public string? CampaignEligibleA { get; set; }

        [Column("campaign_eligible_b")]
        public string? CampaignEligibleB { get; set; }

        [Column("last_contact_date")]
        public string? LastContactDate { get; set; }

        [Column("lifecycle_trig")]
        public string? LifecycleTrig { get; set; }

        [Column("ref_employee_name")]
        public string? RefEmployeeName { get; set; }

        [Column("ref_employee_email")]
        public string? RefEmployeeEmail { get; set; }

        [Column("ref_employee_phone_no")]
        public string? RefEmployeePhoneNo { get; set; }

        [Column("ref_staff_id")]
        public string? RefStaffId { get; set; }

        [Column("rm_name")]
        public string? RmName { get; set; }

        [Column("rm_id")]
        public string? RmId { get; set; }

        [Column("rm_branch_code")]
        public string? RmBranchCode { get; set; }

        [Column("rm_contact_no")]
        public string? RmContactNo { get; set; }

        [Column("profile_pic")]
        public string? ProfilePic { get; set; }

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("opening_date")]
        public string? OpeningDate { get; set; }

        [Column("signatory_date_of_birth")]
        public string? SignatoryDateOfBirth { get; set; }

        [Column("signatory_id_number")]
        public string? SignatoryIdNumber { get; set; }

        [Column("signatory_phone_number")]
        public string? SignatoryPhoneNumber { get; set; }

        [Column("signatory_position")]
        public string? SignatoryPosition { get; set; }

        [Column("engagement_count")]
        public string? EngagementCount { get; set; }

        [Column("eligibility_score")]
        public string? EligibilityScore { get; set; }
    }

    [Table("customer_products")]
    public class CustomerProduct
    {
        [Key]
        [Column("account_number")]
        public string AccountNumber { get; set; } = string.Empty;

        [Column("party_id")]
        public string? PartyId { get; set; }

        [Column("phpr_id")]
        public string? PhprId { get; set; }

        [Column("type")]
        public string? Type { get; set; }

        [Column("product_category")]
        public string? ProductCategory { get; set; }

        [Column("product_name")]
        public string? ProductName { get; set; }

        [Column("tenure")]
        public string? Tenure { get; set; }

        [Column("maturity_date")]
        public string? MaturityDate { get; set; }

        [Column("derived_account_status")]
        public string? DerivedAccountStatus { get; set; }

        [Column("financing_status")]
        public string? FinancingStatus { get; set; }

        [Column("card_status")]
        public string? CardStatus { get; set; }

        [Column("cert_status")]
        public string? CertStatus { get; set; }

        [Column("gold_status")]
        public string? GoldStatus { get; set; }

        [Column("balances")]
        public string? Balances { get; set; }

        [Column("outstanding")]
        public string? Outstanding { get; set; }

        [Column("card_type")]
        public string? CardType { get; set; }

        [Column("campaign_code")]
        public string? CampaignCode { get; set; }

        [Column("last_contact_date")]
        public string? LastContactDate { get; set; }

        [Column("account_opening_date")]
        public string? AccountOpeningDate { get; set; }

        [Column("card_issuance_date")]
        public string? CardIssuanceDate { get; set; }

        [Column("created_date")]
        public string? CreatedDate { get; set; }

        [Column("commencement_date")]
        public string? CommencementDate { get; set; }

        [Column("disbursed_date")]
        public string? DisbursedDate { get; set; }

        [Column("tarikh_daftar_wasiat")]
        public string? TarikhDaftarWasiat { get; set; }
    }

    [Table("interactions")]
    public class Interaction
    {
        [Key]
        [Column("caseid")]
        public string CaseId { get; set; } = string.Empty;

        [Column("party_id")]
        public string? PartyId { get; set; }

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("datecomplaint")]
        public string? DateComplaint { get; set; }

        [Column("datecase")]
        public string? DateCase { get; set; }

        [Column("classification")]
        public string? Classification { get; set; }

        [Column("main")]
        public string? Main { get; set; }

        [Column("category")]
        public string? Category { get; set; }

        [Column("subcategory1")]
        public string? SubCategory1 { get; set; }

        [Column("subcategory2")]
        public string? SubCategory2 { get; set; }

        [Column("status_parent")]
        public string? StatusParent { get; set; }

        [Column("status_child")]
        public string? StatusChild { get; set; }

        [Column("amountinvolved")]
        public string? AmountInvolved { get; set; }

        [Column("nric")]
        public string? Nric { get; set; }

        [Column("sourcename")]
        public string? SourceName { get; set; }

        [Column("statename")]
        public string? StateName { get; set; }

        [Column("channeltio_subroleid")]
        public string? ChannelToSubRoleId { get; set; }

        [Column("subrolename")]
        public string? SubRoleName { get; set; }

        [Column("require_escalation")]
        public string? RequireEscalation { get; set; }

        [Column("createdby_parent")]
        public string? CreatedByParent { get; set; }

        [Column("createddate_parent")]
        public string? CreatedDateParent { get; set; }

        [Column("modifiedby_parent")]
        public string? ModifiedByParent { get; set; }

        [Column("createdby_child")]
        public string? CreatedByChild { get; set; }

        [Column("createddate_child")]
        public string? CreatedDateChild { get; set; }

        [Column("modifiedby_child")]
        public string? ModifiedByChild { get; set; }

        [Column("branchname")]
        public string? BranchName { get; set; }

        [Column("branchhqname")]
        public string? BranchHqName { get; set; }

        [Column("rootnotes")]
        public string? RootNotes { get; set; }

        [Column("action_summary")]
        public string? ActionSummary { get; set; }

        [Column("action_details")]
        public string? ActionDetails { get; set; }

        [Column("description")]
        public string? Description { get; set; }

        [Column("new_acc_no")]
        public string? NewAccNo { get; set; }

        [Column("old_accno")]
        public string? OldAccNo { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }

        [Column("contact_no")]
        public string? ContactNo { get; set; }

        [Column("channel_to")]
        public string? ChannelTo { get; set; }

        [Column("calendar_days")]
        public string? CalendarDays { get; set; }

        [Column("business_days")]
        public string? BusinessDays { get; set; }

        [Column("bnm_name")]
        public string? BnmName { get; set; }

        [Column("mof_name")]
        public string? MofName { get; set; }

        [Column("closeddate")]
        public string? ClosedDate { get; set; }

        [Column("cus_branch_hqname")]
        public string? CusBranchHqName { get; set; }

        [Column("cus_branch_name")]
        public string? CusBranchName { get; set; }

        [Column("cus_role_id")]
        public string? CusRoleId { get; set; }
    }

    [Table("contact_details")]
    public class ContactDetail
    {
        [Key]
        [Column("party_id")]
        public string PartyId { get; set; } = string.Empty;

        [Column("fixed_address")]
        public string? FixedAddress { get; set; }

        [Column("mailing_address")]
        public string? MailingAddress { get; set; }

        [Column("padr_e_mail_1")]
        public string? PadrEmail1 { get; set; }

        [Column("padr_e_mail_2")]
        public string? PadrEmail2 { get; set; }

        [Column("contact_number")]
        public string? ContactNumber { get; set; }

        [Column("nric_brn")]
        public string? NricBrn { get; set; }

        [Column("padr_last_mod_date")]
        public string? PadrLastModDate { get; set; }

        [Column("type")]
        public string? Type { get; set; }

        [Column("position_date")]
        public string? PositionDate { get; set; }
    }

    [Table("deposit_products")]
    public class DepositProduct
    {
        [Key]
        [Column("account_number")]
        public string AccountNumber { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("product_code")]
        public string? ProductCode { get; set; }

        [Column("product_category")]
        public string? ProductCategory { get; set; }

        [Column("product_name")]
        public string? ProductName { get; set; }

        [Column("product_description")]
        public string? ProductDescription { get; set; }

        [Column("derived_account_status")]
        public string? DerivedAccountStatus { get; set; }

        [Column("balances")]
        public string? Balances { get; set; }

        [Column("blocking_reasons")]
        public string? BlockingReasons { get; set; }

        [Column("account_opening_date")]
        public string? AccountOpeningDate { get; set; }

        [Column("account_purposes")]
        public string? AccountPurposes { get; set; }

        [Column("branch_account")]
        public string? BranchAccount { get; set; }

        [Column("state_account")]
        public string? StateAccount { get; set; }

        [Column("placement_amount")]
        public string? PlacementAmount { get; set; }

        [Column("maturity_date")]
        public string? MaturityDate { get; set; }

        [Column("hsmm_rates")]
        public string? HsmmRates { get; set; }

        [Column("maturity_instruction")]
        public string? MaturityInstruction { get; set; }

        [Column("tenure")]
        public string? Tenure { get; set; }

        [Column("crediting_casa_account_no")]
        public string? CreditingCasaAccountNo { get; set; }

        [Column("rn_cerd")]
        public string? RnCerd { get; set; }

        [Column("cerd_purchase_date")]
        public string? CerdPurchaseDate { get; set; }

        [Column("cerd_serial_no")]
        public string? CerdSerialNo { get; set; }

        [Column("cerd_from_cert_num")]
        public string? CerdFromCertNum { get; set; }

        [Column("cerd_to_cert_num")]
        public string? CerdToCertNum { get; set; }

        [Column("cerd_no_of_units")]
        public string? CerdNoOfUnits { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }

        [Column("phpr_id")]
        public string? PhprId { get; set; }

        [Column("cust_id")]
        public string? CustId { get; set; }

        [Column("last_transaction_date")]
        public string? LastTransactionDate { get; set; }

        [Column("old_account_no")]
        public string? OldAccountNo { get; set; }
    }

    [Table("loan_products")]
    public class LoanProduct
    {
        [Key]
        [Column("account_no")]
        public string AccountNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("product_category")]
        public string? ProductCategory { get; set; }

        [Column("product_name")]
        public string? ProductName { get; set; }

        [Column("product_description")]
        public string? ProductDescription { get; set; }

        [Column("financing_status")]
        public string? FinancingStatus { get; set; }

        [Column("outstanding")]
        public string? Outstanding { get; set; }

        [Column("financing_amount")]
        public string? FinancingAmount { get; set; }

        [Column("monthly_installment")]
        public string? MonthlyInstallment { get; set; }

        [Column("original_rate")]
        public string? OriginalRate { get; set; }

        [Column("current_rate")]
        public string? CurrentRate { get; set; }

        [Column("tenure")]
        public string? Tenure { get; set; }

        [Column("maturity_date")]
        public string? MaturityDate { get; set; }

        [Column("disbursed_date")]
        public string? DisbursedDate { get; set; }

        [Column("vehicle_model")]
        public string? VehicleModel { get; set; }

        [Column("property_type")]
        public string? PropertyType { get; set; }

        [Column("property_value_price")]
        public string? PropertyValuePrice { get; set; }

        [Column("property_address")]
        public string? PropertyAddress { get; set; }

        [Column("phpr_id")]
        public string? PhprId { get; set; }

        [Column("mrpr_id")]
        public string? MrprId { get; set; }

        [Column("cust_id")]
        public string? CustId { get; set; }

        [Column("ilom_seq")]
        public string? IlomSeq { get; set; }

        [Column("pay_off_amount")]
        public string? PayOffAmount { get; set; }

        [Column("title_no")]
        public string? TitleNo { get; set; }
    }

    [Table("cards_products")]
    public class CardsProduct
    {
        [Key]
        [Column("account_no")]
        public string AccountNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("card_type")]
        public string? CardType { get; set; }

        [Column("card_type_desc")]
        public string? CardTypeDesc { get; set; }

        [Column("acctbrch")]
        public string? AcctBrch { get; set; }

        [Column("product_code")]
        public string? ProductCode { get; set; }

        [Column("product_name")]
        public string? ProductName { get; set; }

        [Column("credit_limit")]
        public string? CreditLimit { get; set; }

        [Column("outstanding")]
        public string? Outstanding { get; set; }

        [Column("current_due")]
        public string? CurrentDue { get; set; }

        [Column("card_status")]
        public string? CardStatus { get; set; }

        [Column("profit_interest_rate")]
        public string? ProfitInterestRate { get; set; }

        [Column("card_issuance_date")]
        public string? CardIssuanceDate { get; set; }

        [Column("card_expired_date")]
        public string? CardExpiredDate { get; set; }

        [Column("acctblk")]
        public string? AcctBlk { get; set; }

        [Column("card_blk")]
        public string? CardBlk { get; set; }

        [Column("cardblk_date")]
        public string? CardBlkDate { get; set; }

        [Column("nric")]
        public string? Nric { get; set; }

        [Column("custname")]
        public string? CustName { get; set; }

        [Column("instalment_plans_tag")]
        public string? InstalmentPlansTag { get; set; }

        [Column("last_payment_date")]
        public string? LastPaymentDate { get; set; }

        [Column("card_no")]
        public string? CardNo { get; set; }

        [Column("original_rate")]
        public string? OriginalRate { get; set; }

        [Column("current_rate")]
        public string? CurrentRate { get; set; }

        [Column("pay_off_amount")]
        public string? PayOffAmount { get; set; }

        [Column("brn")]
        public string? Brn { get; set; }

        [Column("product_category")]
        public string? ProductCategory { get; set; }

        [Column("casabalance")]
        public string? CasaBalance { get; set; }
    }

    [Table("gold_products")]
    public class GoldProduct
    {
        [Key]
        [Column("gold_account_no")]
        public string GoldAccountNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("account_type")]
        public string? AccountType { get; set; }

        [Column("created_date")]
        public string? CreatedDate { get; set; }

        [Column("status")]
        public string? Status { get; set; }

        [Column("xau_balance")]
        public string? XauBalance { get; set; }

        [Column("total_amount")]
        public string? TotalAmount { get; set; }

        [Column("bank_buy_sell")]
        public string? BankBuySell { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }

        [Column("primary_id_no")]
        public string? PrimaryIdNo { get; set; }
    }

    [Table("wm_products")]
    public class WmProduct
    {
        [Key]
        [Column("policy_no")]
        public string PolicyNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("product_category")]
        public string? ProductCategory { get; set; }

        [Column("provider_name")]
        public string? ProviderName { get; set; }

        [Column("plan_name")]
        public string? PlanName { get; set; }

        [Column("autorenewal")]
        public string? AutoRenewal { get; set; }

        [Column("basic_contribution_amount")]
        public string? BasicContributionAmount { get; set; }

        [Column("commencement_date")]
        public string? CommencementDate { get; set; }

        [Column("certificate_status")]
        public string? CertificateStatus { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }

        [Column("primary_id_number")]
        public string? PrimaryIdNumber { get; set; }

        [Column("payment_mode")]
        public string? PaymentMode { get; set; }

        [Column("expiry_date")]
        public string? ExpiryDate { get; set; }

        [Column("vehicle_no")]
        public string? VehicleNo { get; set; }

        [Column("product_description")]
        public string? ProductDescription { get; set; }
    }

    [Table("unit_trust_products")]
    public class UnitTrustProduct
    {
        [Key]
        [Column("investment_account_no")]
        public string InvestmentAccountNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("fund_name")]
        public string? FundName { get; set; }

        [Column("unit_holdings")]
        public string? UnitHoldings { get; set; }

        [Column("nric")]
        public string? Nric { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }
    }

    [Table("will_writing_products")]
    public class WillWritingProduct
    {
        [Key]
        [Column("will_writing_ref_no")]
        public string WillWritingRefNo { get; set; } = string.Empty;

        [Column("position_date")]
        public string? PositionDate { get; set; }

        [Column("nric")]
        public string? Nric { get; set; }

        [Column("customer_name")]
        public string? CustomerName { get; set; }

        [Column("product_name")]
        public string? ProductName { get; set; }

        [Column("tarikh_daftar_wasiat")]
        public string? TarikhDaftarWasiat { get; set; }
    }
}
