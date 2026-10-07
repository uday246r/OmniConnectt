import React from 'react';
import { ProductPicker } from './ProductPicker';
import { CustomerInformationSection } from './CustomerInformationSection';
import { PreferredSalesExecutiveSection } from './PreferredSalesExecutiveSection';
import { HomeFinancingFields } from './ProductSpecificFields/HomeFinancingFields';
import { MicrofinanceFields } from './ProductSpecificFields/MicrofinanceFields';
import { DeclarationConsentSection } from './DeclarationConsentSection';
import { useLeadStore } from '../../store/useLeadStore';
import { hasVisibleField } from '../../config/fieldControlRegistry';
import { CheckCircle2, Package } from '@omniconnect/ui/icons';
import styles from './LeadFormContainer.module.css';
import { Button, FormSection } from '@omniconnect/ui';
import { useShallow } from 'zustand/react/shallow';

interface LeadFormContainerProps {
  mode?: 'page' | 'drawer';
  onSuccess?: () => void;
}

export const LeadFormContainer: React.FC<LeadFormContainerProps> = ({
  mode = 'page',
  onSuccess,
}) => {
  const { formData, submitLead, isSubmitting, fieldConfig, setProduct, errors } = useLeadStore(useShallow((s) => ({ formData: s.formData, submitLead: s.submitLead, isSubmitting: s.isSubmitting, fieldConfig: s.fieldConfig, setProduct: s.setProduct, errors: s.errors })));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await submitLead();
    if (success && mode === 'drawer' && onSuccess) {
      onSuccess();
    }
  };

  // Which product-specific section to show is config-driven, never a product-name check: every product
  // type's field settings contain the property and business detail fields, hidden until an administrator
  // switches them on for that type in Field Settings (see LeadFieldConfigService.BuildDefaultsFor).
  const showHomeFinancingFields = hasVisibleField(fieldConfig, 'propertyType') || hasVisibleField(fieldConfig, 'propertyStatus');
  const showMicrofinanceFields = hasVisibleField(fieldConfig, 'dateOfIncorporation') || hasVisibleField(fieldConfig, 'companyName') || hasVisibleField(fieldConfig, 'entityType');

  const formContent = (
    <form onSubmit={handleSubmit} noValidate>
      {/* Step 1: category → sub-category → product, from the Marketplace's catalogue. Which product
          is chosen decides which of the fields below exist at all, so it is its own section first. */}
      <div className={styles.stepSpacer}>
        <FormSection title="Product" icon={<Package size={15} />}>
          <ProductPicker
            productName={formData.product}
            onSelect={setProduct}
            error={errors.product}
          />
        </FormSection>
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
        <div className={styles.emptyIcon}>
          <Package size={28} className={styles.emptyGlyph} />
          <div className={styles.emptyText}>Select a product</div>
          <div>
            Which fields this form asks for is configured per product, so choose a category and product
            above to see them.
          </div>
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
