import React from 'react';
import { ProductSelector } from './ProductSelector';
import { CustomerInformationSection } from './CustomerInformationSection';
import { PreferredSalesExecutiveSection } from './PreferredSalesExecutiveSection';
import { HomeFinancingFields } from './ProductSpecificFields/HomeFinancingFields';
import { MicrofinanceFields } from './ProductSpecificFields/MicrofinanceFields';
import { DeclarationConsentSection } from './DeclarationConsentSection';
import { useLeadStore } from '../../store/useLeadStore';
import { Loader2, CheckCircle2 } from '@omniremit/ui/icons';
import styles from './LeadFormContainer.module.css';
import { Button } from '@omniremit/ui';

interface LeadFormContainerProps {
  mode?: 'page' | 'drawer';
  onSuccess?: () => void;
}

export const LeadFormContainer: React.FC<LeadFormContainerProps> = ({
  mode = 'page',
  onSuccess,
}) => {
  const { formData, submitLead, isSubmitting, fieldConfig } = useLeadStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await submitLead();
    if (success && mode === 'drawer' && onSuccess) {
      onSuccess();
    }
  };

  // Which product-specific section to show is now config-driven, not a hardcoded product-name
  // check: a product's field config only ever contains propertyType/dateOfIncorporation rows when
  // that product's catalog actually has them (see LeadFieldConfigService.BuildDefaultsFor), so their
  // mere presence in the loaded config is exactly the signal that used to be `product === 'Home
  // Financing'` / `'Micro Finance'` — the underlying rendered components are unchanged.
  const showHomeFinancingFields = fieldConfig.some((f) => f.apiField === 'propertyType');
  const showMicrofinanceFields = fieldConfig.some((f) => f.apiField === 'dateOfIncorporation');

  const formContent = (
    <form onSubmit={handleSubmit} noValidate>
      {/* Step 1: Product Selection */}
      <div className={styles.stepSpacer}>
        <ProductSelector />
      </div>

      {/* Display form only when a product is selected */}
      {formData.product ? (
        <div className={styles.formFade}>
          <CustomerInformationSection />
          <PreferredSalesExecutiveSection />
          {showHomeFinancingFields && <HomeFinancingFields />}
          {showMicrofinanceFields && <MicrofinanceFields />}
          <DeclarationConsentSection />

          {/* Submit Button — only in page mode */}
          {mode === 'page' && (
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={isSubmitting}
              leadingIcon={<CheckCircle2 size={18} />}
              className={styles.submit}
              id="lead-submit-button"
            >
              {isSubmitting ? 'Submitting Application...' : 'Submit Lead Application'}
            </Button>
          )}
        </div>
      ) : (
        <div
          className={styles.emptyIcon}
        >
          <div className={styles.emptyTitle}>📋</div>
          <div className={styles.emptyText}>
            Select a Financing Product
          </div>
          <div>Choose a product above to display the lead application form fields.</div>
        </div>
      )}
    </form>
  );

  // Drawer mode: return just the form content
  if (mode === 'drawer') {
    return formContent;
  }

  // Page mode: render without extra card wrapper — CreateLeadPage provides the card
  return formContent;
};
