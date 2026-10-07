import React from 'react';
import { ScrollText } from '@omniconnect/ui/icons';
import { Checkbox, FormField, FormSection } from '@omniconnect/ui';
import { useLeadStore } from '../../store/useLeadStore';
import { useShallow } from 'zustand/react/shallow';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../config/fieldControlRegistry';
import styles from './leadFormSection.module.css';

interface DeclarationConsentSectionProps {
  isEdit?: boolean;
}

/**
 * The two things the customer has to answer for themselves: whether the bank may market to them, and
 * that they have read the privacy policy.
 *
 * The consent wording is deliberately long and is quoted in full — it is a declaration the customer
 * makes, not a UI label to be shortened.
 */
export const DeclarationConsentSection: React.FC<DeclarationConsentSectionProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, fieldConfig: s.fieldConfig, showToast: s.showToast })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const config = store.fieldConfig;

  const marketingConsentLocked = isEdit && !isFieldEditable(config, 'marketingConsent');
  const privacyPolicyLocked = isEdit && !isFieldEditable(config, 'agreedToPrivacyPolicy');

  return (
    <FormSection title="Declaration" icon={<ScrollText size={15} />}>
      {isFieldVisible(config, 'marketingConsent') && (
        <FormField
          label={getFieldLabel(config, 'marketingConsent', 'Declaration/Consent')}
          required={isFieldRequired(config, 'marketingConsent')}
          error={errors.marketingConsent}
          full
        >
          {/* Two radios under one name: a group named by the label, not a single control. */}
          <div className={styles.consentText}>
            <label className={styles.consent}>
              <input
                type="radio"
                name="marketingConsent"
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

            <label className={styles.consent}>
              <input
                type="radio"
                name="marketingConsent"
                value="DO_NOT_CONSENT"
                checked={formData.marketingConsent === 'DO_NOT_CONSENT'}
                disabled={marketingConsentLocked}
                onChange={() => setFieldValue('marketingConsent', 'DO_NOT_CONSENT')}
              />
              <span>
                I hereby <strong>DO NOT CONSENT and DO NOT AUTHORISE</strong> the Bank to disclose and
                share my information for the purpose of cross selling, marketing and promotional
                activities with any party.
              </span>
            </label>
          </div>
        </FormField>
      )}

      {isFieldVisible(config, 'agreedToPrivacyPolicy') && (
        <>
          <Checkbox
            checked={formData.agreedToPrivacyPolicy}
            disabled={privacyPolicyLocked}
            onChange={(e) => setFieldValue('agreedToPrivacyPolicy', e.target.checked)}
            label={
              <span className={styles.consentText}>
                I have read and agree to Bank Simpanan Nasional&apos;s{' '}
                <a
                  href="#privacy-policy"
                  onClick={(e) => {
                    e.preventDefault();
                    // Was a browser alert(), which is the one dialog on the platform nothing else uses
                    // and which cannot be styled or dismissed with the keyboard like the rest.
                    store.showToast({
                      type: 'info',
                      title: 'Privacy Policy',
                      message:
                        'Your data is collected and processed in accordance with the Malaysian Personal Data Protection Act (PDPA) 2010.',
                    });
                  }}
                >
                  Privacy Policy
                </a>
                . I consent and acknowledge that Bank Simpanan Nasional may, inter alia, collect, store
                and process the data and information provided in this form for the purpose of processing
                my request and contacting me via email and/or phone to follow up on my submission.
              </span>
            }
          />

          {errors.agreedToPrivacyPolicy && (
            <div className={styles.consentError} role="alert">
              {errors.agreedToPrivacyPolicy}
            </div>
          )}
        </>
      )}
    </FormSection>
  );
};
