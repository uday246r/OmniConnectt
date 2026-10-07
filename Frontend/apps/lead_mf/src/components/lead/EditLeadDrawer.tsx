import React, { useMemo } from 'react';
import { Save, ArrowLeft, CheckCircle2 } from '@omniconnect/ui/icons';
import { Button, Drawer, EmptyState, SkeletonForm } from '@omniconnect/ui';
import { ProductPicker } from './ProductPicker';
import { hasVisibleField } from '../../config/fieldControlRegistry';
import { LeadDiffTable } from '../../shared/LeadDiffTable';
import { useLeadStore } from '../../store/useLeadStore';
import drawerLayout from '../../shared/drawerLayout.module.css';
import form from '../../shared/formField.module.css';

/** Ties step 1's footer submit button to the edit form rendered in the Drawer body. */
const EDIT_FORM_ID = 'edit-lead-form';
import { CustomerInformationSection } from './CustomerInformationSection';
import { PreferredSalesExecutiveSection } from './PreferredSalesExecutiveSection';
import { HomeFinancingFields } from './ProductSpecificFields/HomeFinancingFields';
import { MicrofinanceFields } from './ProductSpecificFields/MicrofinanceFields';
import { DeclarationConsentSection } from './DeclarationConsentSection';
import { FieldDiff } from '../../types/lead';
import styles from './EditLeadDrawer.module.css';
import { useShallow } from 'zustand/react/shallow';

export const EditLeadDrawer: React.FC = () => {
  const {
    isEditLeadOpen,
    editLeadTarget,
    editReason,
    editFormData,
    editErrors,
    setEditProduct,
    validateEditForm,
    submitEditLead,
    closeEditLeadDrawer,
    isConfirmingEdit,
    setIsConfirmingEdit,
    isSubmitting,
    fieldConfig,
    isLoadingFieldConfig,
  } = useLeadStore(useShallow((s) => ({ isEditLeadOpen: s.isEditLeadOpen, editLeadTarget: s.editLeadTarget, editReason: s.editReason, editFormData: s.editFormData, editErrors: s.editErrors, setEditProduct: s.setEditProduct, validateEditForm: s.validateEditForm, submitEditLead: s.submitEditLead, closeEditLeadDrawer: s.closeEditLeadDrawer, isConfirmingEdit: s.isConfirmingEdit, setIsConfirmingEdit: s.setIsConfirmingEdit, isSubmitting: s.isSubmitting, fieldConfig: s.fieldConfig, isLoadingFieldConfig: s.isLoadingFieldConfig })));

  // Compute diffs between original lead target and current editFormData
  const changedFields = useMemo<FieldDiff[]>(() => {
    if (!editLeadTarget) return [];

    const diffs: FieldDiff[] = [];
    const orig = editLeadTarget;
    const form = editFormData;

    const compare = (label: string, oldVal: string | undefined | null, newVal: string | undefined | null) => {
      let o = (oldVal ?? '').trim();
      let n = (newVal ?? '').trim();
      if (label === 'Applied Amount') {
        o = o.replace(/,/g, '').replace(/\.00$/, '');
        n = n.replace(/,/g, '').replace(/\.00$/, '');
      }
      if (o !== n) {
        diffs.push({
          field: label,
          previousValue: (oldVal ?? '').trim() || '—',
          newValue: (newVal ?? '').trim() || '—',
        });
      }
    };

    compare('Customer Name', orig.name, form.customerName);
    compare('IC Number', orig.icNumber, form.icNumber);
    compare('Phone Number', orig.phone, `${form.phoneCountryCode} ${form.phoneNumber}`.trim());
    compare('Email Address', orig.email, form.email);
    compare('Product', orig.product, form.product);
    compare('State', orig.state, form.state);
    compare('Preferred Branch', orig.branch, form.preferredBranch || 'Not Assigned');
    compare('Employer Name', orig.employerName, form.employerName);
    compare('Applied Amount', orig.appliedAmount, form.appliedAmount);
    compare('Preferred Sales Executive', orig.preferredSalesExecutive, form.hasPreferredSalesExecutive ? form.preferredSalesExecutive : 'None');

    // Product details: compared for the fields Field Settings shows for this lead's product type,
    // never by looking at what the product is called.
    const detailFields: [string, string, string | undefined, string][] = [
      ['propertyType', 'Property Type', orig.propertyType, form.propertyType],
      ['propertyStatus', 'Property Status', orig.propertyStatus, form.propertyStatus],
      ['dateOfIncorporation', 'Date of Incorporation', orig.dateOfIncorporation, form.dateOfIncorporation],
      ['companyName', 'Company Name', orig.companyName, form.companyName],
      ['entityType', 'Entity Type', orig.entityType, form.entityType],
    ];
    for (const [apiField, label, before, after] of detailFields) {
      if (hasVisibleField(fieldConfig, apiField)) compare(label, before, after);
    }

    compare('Marketing Consent', orig.marketingConsent, form.marketingConsent);

    return diffs;
  }, [editLeadTarget, editFormData, fieldConfig]);

  if (!isEditLeadOpen || !editLeadTarget) return null;

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = validateEditForm();
    if (isValid) {
      setIsConfirmingEdit(true);
    }
  };

  const handleFinalConfirmSave = async () => {
    await submitEditLead(editReason);
  };

  return (
    <Drawer
      open
      onClose={closeEditLeadDrawer}
      closeLabel="Close edit drawer"
      title={isConfirmingEdit ? 'Confirm Lead Changes' : 'Edit Lead Information'}
      subtitle={`Reason: "${editReason}"`}
      footer={
        isConfirmingEdit ? (
          <div className={drawerLayout.footerSpread}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsConfirmingEdit(false)}
              leadingIcon={<ArrowLeft size={16} />}
            >
              Back / Edit
            </Button>
            <div className={drawerLayout.footerActions}>
              <Button type="button" variant="secondary" onClick={closeEditLeadDrawer}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={isSubmitting}
                onClick={handleFinalConfirmSave}
                leadingIcon={<Save size={16} />}
              >
                {isSubmitting ? 'Saving...' : 'Confirm & Save'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={closeEditLeadDrawer}>
              Cancel
            </Button>
            <Button type="submit" form={EDIT_FORM_ID} leadingIcon={<Save size={16} />}>
              Save Changes
            </Button>
          </>
        )
      }
    >
      {!isConfirmingEdit ? (
        /* STEP 1: EDIT FORM */
        <form id={EDIT_FORM_ID} onSubmit={handleSaveClick}>
              {/* Product Selection — a lead keeps its product unless a different one is chosen from the catalogue */}
              <div className={form.stackWide}>
                <ProductPicker
                  id="edit-lead-product"
                  productName={editFormData.product}
                  onSelect={setEditProduct}
                  error={editErrors.product}
                />
              </div>

              {/* The same reason as the create form: a field counts as visible until the settings
                  say otherwise, so drawing the sections before the settings arrive showed every
                  field and then removed the ones that are switched off. */}
              {isLoadingFieldConfig ? (
                <SkeletonForm sections={3} fieldsPerSection={4} />
              ) : (
              <>
              {/* Common Customer Details */}
              <CustomerInformationSection isEdit={true} />

              {/* Preferred Sales Executive */}
              <div className={form.stack}>
                <PreferredSalesExecutiveSection isEdit={true} />
              </div>

              {/* Product Specific Fields — config-driven, see LeadFormContainer's identical comment */}
              <div className={form.stack}>
                {(hasVisibleField(fieldConfig, 'propertyType') || hasVisibleField(fieldConfig, 'propertyStatus')) && <HomeFinancingFields isEdit={true} />}
                {(hasVisibleField(fieldConfig, 'dateOfIncorporation') || hasVisibleField(fieldConfig, 'companyName') || hasVisibleField(fieldConfig, 'entityType')) && <MicrofinanceFields isEdit={true} />}
              </div>

              {/* Declaration & Consent */}
              <div className={form.stack}>
                <DeclarationConsentSection isEdit={true} />
              </div>
              </>
              )}
        </form>
      ) : (
        /* STEP 2: CONFIRMATION DIFF TABLE */
        <>
              <div className={form.infoNote}>
                <CheckCircle2 size={22} className={form.infoIcon} />
                <div>
                  <div className={form.infoTitle}>
                    Review Changed Fields Before Persisting
                  </div>
                  <div className={styles.changeHint}>
                    The table below highlights only the fields that were modified. Confirming will save changes to the database and generate a backend audit log.
                  </div>
                </div>
              </div>

              {changedFields.length === 0 ? (
                /* The previous inline style here read `border: '1px border #e2e8f0'` — invalid CSS,
                   so the border silently never rendered. */
                <EmptyState
                  compact
                  title="No fields were modified"
                  description="Click Save Changes to exit, or Back to continue editing."
                />
              ) : (
                <LeadDiffTable diffs={changedFields} />
              )}
        </>
      )}
    </Drawer>
  );
};
