import React from 'react';
import { ScrollText } from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../config/fieldControlRegistry';
import styles from './DeclarationConsentSection.module.css';

interface DeclarationConsentSectionProps {
  isEdit?: boolean;
}

export const DeclarationConsentSection: React.FC<DeclarationConsentSectionProps> = ({ isEdit = false }) => {
  const store = useLeadStore();
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const config = store.fieldConfig;

  const marketingConsentLocked = isEdit && !isFieldEditable(config, 'marketingConsent');
  const privacyPolicyLocked = isEdit && !isFieldEditable(config, 'agreedToPrivacyPolicy');

  return (
    <div className="form-section">
      <div className="form-section-title">
        <ScrollText size={18} className="form-section-icon" />
        <span>Declaration</span>
      </div>

      {/* Radio options for Declaration/Consent */}
      {isFieldVisible(config, 'marketingConsent') && (
        <div className={styles.section}>
          <div className={`form-label ${styles.sectionLabel}`}>
            {getFieldLabel(config, 'marketingConsent', 'Declaration/Consent')}{' '}
            {isFieldRequired(config, 'marketingConsent') && <span className="required-asterisk">*</span>}
          </div>

          <div className={styles.optionList}>
            <label className="custom-radio-label">
              <input
                type="radio"
                name="marketingConsent"
                className="custom-radio-input"
                value="CONSENT"
                checked={formData.marketingConsent === 'CONSENT'}
                disabled={marketingConsentLocked}
                onChange={() => setFieldValue('marketingConsent', 'CONSENT')}
              />
              <span>
                I hereby <strong>CONSENT and AUTHORISE</strong> the Bank to disclose and share my
                information for the purpose of cross selling, marketing and promotional activities with
                any party.
              </span>
            </label>

            <label className="custom-radio-label">
              <input
                type="radio"
                name="marketingConsent"
                className="custom-radio-input"
                value="DO_NOT_CONSENT"
                checked={formData.marketingConsent === 'DO_NOT_CONSENT'}
                disabled={marketingConsentLocked}
                onChange={() => setFieldValue('marketingConsent', 'DO_NOT_CONSENT')}
              />
              <span>
                I hereby <strong>DO NOT CONSENT and DO NOT AUTHORISE</strong> the Bank to disclose and share
                my information for the purpose of cross selling, marketing and promotional activities
                with any party.
              </span>
            </label>
          </div>

          {errors.marketingConsent && (
            <div className={`field-error-message ${styles.optionRow}`}>
              {errors.marketingConsent}
            </div>
          )}
        </div>
      )}

      {/* Mandatory Privacy Policy Agreement */}
      {isFieldVisible(config, 'agreedToPrivacyPolicy') && (
        <div className={styles.optionHint}>
          <label className="custom-checkbox-label">
            <input
              type="checkbox"
              className="custom-checkbox-input"
              checked={formData.agreedToPrivacyPolicy}
              disabled={privacyPolicyLocked}
              onChange={(e) => setFieldValue('agreedToPrivacyPolicy', e.target.checked)}
            />
            <span className={styles.errorText}>
              I have read and agree to Bank Simpanan Nasional&apos;s{' '}
              <a
                href="#privacy-policy"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Bank Simpanan Nasional Privacy Policy: Your data is collected and processed in accordance with the Malaysian Personal Data Protection Act (PDPA) 2010.');
                }}
                className={styles.noteText}
              >
                Privacy Policy
              </a>
              . I consent and acknowledge that Bank Simpanan Nasional may, inter alia, collect, store
              and process the data and information provided in this form for the purpose of processing
              my request and contacting me via email and/or phone to follow up on my submission.
            </span>
          </label>

          {errors.agreedToPrivacyPolicy && (
            <div className={`field-error-message ${styles.optionRow}`}>
              {errors.agreedToPrivacyPolicy}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
