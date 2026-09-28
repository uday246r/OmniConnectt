import type { FieldConfig } from '../types/api';

export const DEFAULT_INDIVIDUAL_FIELD_CONFIGS: FieldConfig[] = [
  { id: 'ind_0', profileType: 'Individual', apiField: 'salutation', displayLabel: 'Salutation', section: 'Personal Details', displayOrder: 0, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_1', profileType: 'Individual', apiField: 'gender', displayLabel: 'Gender', section: 'Personal Details', displayOrder: 1, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_2', profileType: 'Individual', apiField: 'birthDate', displayLabel: 'Date of Birth', section: 'Personal Details', displayOrder: 2, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_3', profileType: 'Individual', apiField: 'race', displayLabel: 'Race', section: 'Personal Details', displayOrder: 3, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_4', profileType: 'Individual', apiField: 'religion', displayLabel: 'Religion', section: 'Personal Details', displayOrder: 4, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_5', profileType: 'Individual', apiField: 'bumiStatus', displayLabel: 'Bumi Status', section: 'Personal Details', displayOrder: 5, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_6', profileType: 'Individual', apiField: 'educationLevel', displayLabel: 'Higher Education Level', section: 'Personal Details', displayOrder: 6, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_7', profileType: 'Individual', apiField: 'hnwi', displayLabel: 'HNW Individual - Indicator', section: 'Personal Details', displayOrder: 7, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_8', profileType: 'Individual', apiField: 'pep', displayLabel: 'NRIC/Political Person', section: 'Personal Details', displayOrder: 8, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_9', profileType: 'Individual', apiField: 'status', displayLabel: 'Marital Status', section: 'Personal Details', displayOrder: 9, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_10', profileType: 'Individual', apiField: 'disabilityStatus', displayLabel: 'Disability Status', section: 'Personal Details', displayOrder: 10, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_11', profileType: 'Individual', apiField: 'branch', displayLabel: 'Customer Branch', section: 'Personal Details', displayOrder: 11, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_12', profileType: 'Individual', apiField: 'pdpaTag', displayLabel: 'PDPA', section: 'Personal Details', displayOrder: 12, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_13', profileType: 'Individual', apiField: 'phprId', displayLabel: 'CIF', section: 'Personal Details', displayOrder: 13, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_14', profileType: 'Individual', apiField: 'nationalId', displayLabel: 'Primary ID Number', section: 'Personal Details', displayOrder: 14, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'ind_15', profileType: 'Individual', apiField: 'oldId', displayLabel: 'Secondary ID Number', section: 'Personal Details', displayOrder: 15, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'ind_16', profileType: 'Individual', apiField: 'passport', displayLabel: 'Passport Number', section: 'Personal Details', displayOrder: 16, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'ind_17', profileType: 'Individual', apiField: 'languagePreferred', displayLabel: 'Preferred Language', section: 'Personal Details', displayOrder: 17, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_18', profileType: 'Individual', apiField: 'mybsnInd', displayLabel: 'MyBsn Active', section: 'Personal Details', displayOrder: 18, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_19', profileType: 'Individual', apiField: 'vipTagging', displayLabel: 'VIP Tagging', section: 'Personal Details', displayOrder: 19, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'ind_20', profileType: 'Individual', apiField: 'placeBirth', displayLabel: 'Place of Birth', section: 'Residency Details', displayOrder: 20, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_21', profileType: 'Individual', apiField: 'citizenship', displayLabel: 'Citizenship', section: 'Residency Details', displayOrder: 21, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_22', profileType: 'Individual', apiField: 'resdCode', displayLabel: 'Resident / Non Resident Indicator', section: 'Residency Details', displayOrder: 22, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_23', profileType: 'Individual', apiField: 'contact.fixedAddress', displayLabel: 'Residency Address', section: 'Residency Details', displayOrder: 23, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'ind_24', profileType: 'Individual', apiField: 'contact.padrEmail1', displayLabel: 'Email', section: 'Contact Details', displayOrder: 24, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_25', profileType: 'Individual', apiField: 'contact.contactNumber', displayLabel: 'Phone', section: 'Contact Details', displayOrder: 25, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'ind_26', profileType: 'Individual', apiField: 'preferComChnl', displayLabel: 'Preferred Communication Channel', section: 'Contact Details', displayOrder: 26, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_27', profileType: 'Individual', apiField: 'marketMessageOpt', displayLabel: 'Marketing Message Opt-In/Out', section: 'Contact Details', displayOrder: 27, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'ind_28', profileType: 'Individual', apiField: 'jobStatus', displayLabel: 'Employment Status', section: 'Employment Details', displayOrder: 28, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_29', profileType: 'Individual', apiField: 'employerName', displayLabel: 'Employer Company Name', section: 'Employment Details', displayOrder: 29, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_30', profileType: 'Individual', apiField: 'employerPhone', displayLabel: 'Employer Phone', section: 'Employment Details', displayOrder: 30, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_31', profileType: 'Individual', apiField: 'employerEmail', displayLabel: 'Employer Email', section: 'Employment Details', displayOrder: 31, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_32', profileType: 'Individual', apiField: 'payrollInd', displayLabel: 'Payroll Indicator', section: 'Employment Details', displayOrder: 32, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_33', profileType: 'Individual', apiField: 'designation', displayLabel: 'Designation', section: 'Employment Details', displayOrder: 33, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_34', profileType: 'Individual', apiField: 'occupation', displayLabel: 'Occupation', section: 'Employment Details', displayOrder: 34, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_35', profileType: 'Individual', apiField: 'industry', displayLabel: 'Industry', section: 'Employment Details', displayOrder: 35, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_36', profileType: 'Individual', apiField: 'annualIncome', displayLabel: 'Income Range (Annual/Yearly)', section: 'Employment Details', displayOrder: 36, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_37', profileType: 'Individual', apiField: 'employerAddress', displayLabel: 'Employer Address', section: 'Employment Details', displayOrder: 37, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'ind_38', profileType: 'Individual', apiField: 'openingDate', displayLabel: 'Customer Onboarding Date', section: 'Additional Details', displayOrder: 38, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_39', profileType: 'Individual', apiField: 'turnedNonResidentDate', displayLabel: 'Turned Non-Resident On Date', section: 'Additional Details', displayOrder: 39, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_40', profileType: 'Individual', apiField: 'lastContactDate', displayLabel: 'Last Contact Date', section: 'Additional Details', displayOrder: 40, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_41', profileType: 'Individual', apiField: 'flags', displayLabel: 'Customer Flags/Notes', section: 'Additional Details', displayOrder: 41, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_42', profileType: 'Individual', apiField: 'segmentation', displayLabel: 'Customer Segmentation', section: 'Additional Details', displayOrder: 42, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'ind_43', profileType: 'Individual', apiField: 'refEmployeeName', displayLabel: 'Referrer Employee Name', section: 'Referrer & Relationship Information', displayOrder: 43, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_44', profileType: 'Individual', apiField: 'refEmployeeEmail', displayLabel: 'Referrer Employee Email', section: 'Referrer & Relationship Information', displayOrder: 44, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'ind_45', profileType: 'Individual', apiField: 'refEmployeeId', displayLabel: 'Referrer Employee ID', section: 'Referrer & Relationship Information', displayOrder: 45, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
];

export const DEFAULT_CORPORATE_FIELD_CONFIGS: FieldConfig[] = [
  { id: 'corp_1', profileType: 'Corporate', apiField: 'organizationType', displayLabel: 'Type of Organization', section: 'Company Details', displayOrder: 1, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_2', profileType: 'Corporate', apiField: 'country', displayLabel: 'Country of Incorporation', section: 'Company Details', displayOrder: 2, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_3', profileType: 'Corporate', apiField: 'onlineBankingRegistrationStatus', displayLabel: 'Online Banking Registration Status', section: 'Online Banking Status', displayOrder: 3, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_4', profileType: 'Corporate', apiField: 'onlineBankingActivationStatus', displayLabel: 'Online Banking Activation Status', section: 'Online Banking Status', displayOrder: 4, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_5', profileType: 'Corporate', apiField: 'businessRegDate', displayLabel: 'Date of Business Registration', section: 'Business Registration', displayOrder: 5, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_6', profileType: 'Corporate', apiField: 'openingDate', displayLabel: 'Organization Onboarding Date', section: 'Business Registration', displayOrder: 6, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_7', profileType: 'Corporate', apiField: 'organizationName', displayLabel: 'Organization Name', section: 'Company Information', displayOrder: 7, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_8', profileType: 'Corporate', apiField: 'brn', displayLabel: 'Old Business Registration Number (BRN)', section: 'Company Information', displayOrder: 8, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_9', profileType: 'Corporate', apiField: 'brn2', displayLabel: 'New Business Registration Number (BRN)', section: 'Company Information', displayOrder: 9, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_10', profileType: 'Corporate', apiField: 'economicSector', displayLabel: 'Economic Sector', section: 'Company Information', displayOrder: 10, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_11', profileType: 'Corporate', apiField: 'companyWebsite', displayLabel: 'Company Website', section: 'Company Information', displayOrder: 11, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_12', profileType: 'Corporate', apiField: 'tin', displayLabel: 'Tax Identification Number', section: 'Company Information', displayOrder: 12, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'corp_13', profileType: 'Corporate', apiField: 'cifNumber', displayLabel: 'CIF Number', section: 'Company Information', displayOrder: 13, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_14', profileType: 'Corporate', apiField: 'annualIncome', displayLabel: 'Annual Income', section: 'Company Information', displayOrder: 14, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_15', profileType: 'Corporate', apiField: 'residentType', displayLabel: 'Resident Type', section: 'Company Information', displayOrder: 15, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_16', profileType: 'Corporate', apiField: 'residentAddress', displayLabel: 'Resident Address', section: 'Company Information', displayOrder: 16, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_16a', profileType: 'Corporate', apiField: 'salutation', displayLabel: 'Salutation', section: 'Company Information', displayOrder: 17, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_16b', profileType: 'Corporate', apiField: 'segmentation', displayLabel: 'Customer Segmentation', section: 'Company Information', displayOrder: 18, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_17', profileType: 'Corporate', apiField: 'contact.padrEmail1', displayLabel: 'Email', section: 'Contact Information', displayOrder: 17, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_18', profileType: 'Corporate', apiField: 'contact.contactNumber', displayLabel: 'Phone Number', section: 'Contact Information', displayOrder: 18, visible: true, sensitive: true, maskingRule: 'HideFirstShowLast', visibleCharCount: 4 },
  { id: 'corp_19', profileType: 'Corporate', apiField: 'marketMessageOpt', displayLabel: 'Marketing Message Opt-In/Out', section: 'Contact Information', displayOrder: 19, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_20', profileType: 'Corporate', apiField: 'contact.fixedAddress', displayLabel: 'Address', section: 'Contact Information', displayOrder: 20, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_21', profileType: 'Corporate', apiField: 'refEmployeeName', displayLabel: 'Referrer Employee Name', section: 'Referrer & Relationship Information', displayOrder: 21, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_22', profileType: 'Corporate', apiField: 'refEmployeeEmail', displayLabel: 'Referrer Employee Email', section: 'Referrer & Relationship Information', displayOrder: 22, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_23', profileType: 'Corporate', apiField: 'refEmployeePhoneNo', displayLabel: 'Referrer Employee Phone Number', section: 'Referrer & Relationship Information', displayOrder: 23, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_24', profileType: 'Corporate', apiField: 'refStaffId', displayLabel: 'Staff ID', section: 'Referrer & Relationship Information', displayOrder: 24, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },

  { id: 'corp_25', profileType: 'Corporate', apiField: 'rmName', displayLabel: 'RM Name', section: 'RM Manager Information', displayOrder: 25, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_26', profileType: 'Corporate', apiField: 'rmId', displayLabel: 'RM ID', section: 'RM Manager Information', displayOrder: 26, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_27', profileType: 'Corporate', apiField: 'rmBranchCode', displayLabel: 'RM Branch Code', section: 'RM Manager Information', displayOrder: 27, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
  { id: 'corp_28', profileType: 'Corporate', apiField: 'rmContactNo', displayLabel: 'RM Contact Number', section: 'RM Manager Information', displayOrder: 28, visible: true, sensitive: false, maskingRule: 'None', visibleCharCount: 0 },
];
