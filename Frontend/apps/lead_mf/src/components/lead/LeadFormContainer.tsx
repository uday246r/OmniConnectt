import React from 'react';
import { ProductPicker } from './ProductPicker';
import { CustomerInformationSection } from './CustomerInformationSection';
import { PreferredSalesExecutiveSection } from './PreferredSalesExecutiveSection';
import { HomeFinancingFields } from './ProductSpecificFields/HomeFinancingFields';
import { MicrofinanceFields } from './ProductSpecificFields/MicrofinanceFields';
import { DeclarationConsentSection } from './DeclarationConsentSection';
import { useLeadStore } from '../../store/useLeadStore';
import { hasVisibleField } from '../../config/fieldControlRegistry';
import { CheckCircle2, Info, Package, RotateCcw } from '@omniconnect/ui/icons';
import styles from './LeadFormContainer.module.css';
import { Button, FormSection, SkeletonForm } from '@omniconnect/ui';
import { useShallow } from 'zustand/react/shallow';

interface LeadFormContainerProps {
  mode?: 'page' | 'drawer';
  onSuccess?: () => void;
}

/**
 * The Create Lead form.
 *
 * In page mode it is the whole card, in three bands: the product step across the top, the fields on a
 * sunken body, and the actions in a footer. Until a product is chosen only the first band exists —
 * the product decides which fields there are, so there is nothing truthful to draw below it yet.
 *
 * That replaced a large dashed "Select a product" panel under the pickers, which filled the card with
 * an empty state that only repeated what the three dropdowns above it already said. The prompt is now
 * one quiet line inside the product band, and the space it took is given back.
 */
export const LeadFormContainer: React.FC<LeadFormContainerProps> = ({
  mode = 'page',
  onSuccess,
}) => {
  const { formData, submitLead, isSubmitting, fieldConfig, isLoadingFieldConfig, setProduct, resetForm, errors } = useLeadStore(
    useShallow((s) => ({
      formData: s.formData,
      submitLead: s.submitLead,
      isSubmitting: s.isSubmitting,
      fieldConfig: s.fieldConfig,
      isLoadingFieldConfig: s.isLoadingFieldConfig,
      setProduct: s.setProduct,
      resetForm: s.resetForm,
      errors: s.errors,
    })),
  );

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

  const hasProduct = Boolean(formData.product);

  /*
   * While the chosen product's field settings are on their way, the sections are placeholders shaped
   * like the sections. Rendering the real ones straight away was wrong in a specific way: a field
   * counts as visible until the settings say otherwise, so every field appeared for a moment and the
   * ones the administrator had switched off then disappeared — the form visibly rearranged itself.
   */
  const sections = isLoadingFieldConfig ? (
    <SkeletonForm sections={3} fieldsPerSection={4} />
  ) : (
    <div className={styles.formFade}>
      <CustomerInformationSection />
      <PreferredSalesExecutiveSection />
      {showHomeFinancingFields && <HomeFinancingFields />}
      {showMicrofinanceFields && <MicrofinanceFields />}
      <DeclarationConsentSection />
    </div>
  );

  // Drawer mode: just the form, in the drawer's own frame.
  if (mode === 'drawer') {
    return (
      <form onSubmit={handleSubmit} noValidate className={styles.sections}>
        <FormSection title="Product" icon={<Package size={15} />}>
          <ProductPicker productName={formData.product} onSelect={setProduct} error={errors.product} />
        </FormSection>
        {hasProduct && sections}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={styles.form}>
      {/* Step 1: category → sub-category → product, from the Marketplace's catalogue. Which product
          is chosen decides which of the fields below exist at all, so it heads the card. */}
      <div className={styles.productBand}>
        <div className={styles.bandHead}>
          <span className={styles.bandIcon} aria-hidden="true">
            <Package size={19} />
          </span>
          <div className={styles.bandText}>
            <h2 className={styles.bandTitle}>Product</h2>
            <p className={styles.bandHint}>The product decides which details this application asks for.</p>
          </div>
          {hasProduct && (
            <span className={styles.chosen}>
              <CheckCircle2 size={14} aria-hidden="true" />
              {formData.product}
            </span>
          )}
        </div>

        <ProductPicker productName={formData.product} onSelect={setProduct} error={errors.product} />

        {!hasProduct && (
          <p className={styles.prompt}>
            <Info size={14} aria-hidden="true" className={styles.promptIcon} />
            Select a product to open its application form.
          </p>
        )}
      </div>

      {hasProduct && (
        <>
          <div className={styles.body}>{sections}</div>

          <div className={styles.footer}>
            <span className={styles.footerNote}>
              Fields marked <span className={styles.asterisk}>*</span> are required.
            </span>
            <div className={styles.footerActions}>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting} leadingIcon={<RotateCcw size={15} />}>
                Clear form
              </Button>
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={isLoadingFieldConfig}
                leadingIcon={<CheckCircle2 size={17} />}
                id="lead-submit-button"
              >
                {isSubmitting ? 'Submitting Application...' : 'Submit Lead Application'}
              </Button>
            </div>
          </div>
        </>
      )}
    </form>
  );
};
