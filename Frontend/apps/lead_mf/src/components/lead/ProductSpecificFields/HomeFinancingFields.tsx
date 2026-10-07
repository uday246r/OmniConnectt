import React from 'react';
import { Home } from '@omniconnect/ui/icons';
import { Combobox, FormField, FormGrid, FormSection } from '@omniconnect/ui';
import { useLeadStore } from '../../../store/useLeadStore';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../../config/fieldControlRegistry';
import { useShallow } from 'zustand/react/shallow';

interface HomeFinancingFieldsProps {
  isEdit?: boolean;
}

/**
 * The property a home-financing lead is about.
 *
 * Shown only when Field Settings has switched one of these fields on for the chosen product — never
 * decided from the product's name (see `LeadFormContainer`).
 */
export const HomeFinancingFields: React.FC<HomeFinancingFieldsProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, propertyTypes: s.propertyTypes, propertyStatuses: s.propertyStatuses, validateField: s.validateField, fieldConfig: s.fieldConfig })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const propertyTypes = store.propertyTypes;
  const propertyStatuses = store.propertyStatuses;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  return (
    <FormSection title="Property Details" icon={<Home size={15} />}>
      <FormGrid>
        {isFieldVisible(config, 'propertyType') && (
          <FormField
            label={getFieldLabel(config, 'propertyType', 'Property Type')}
            required={isFieldRequired(config, 'propertyType')}
            error={errors.propertyType}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={propertyTypes}
                value={formData.propertyType}
                disabled={isEdit && !isFieldEditable(config, 'propertyType')}
                placeholder="Select Property Type"
                onChange={(val) => setFieldValue('propertyType', val)}
                onBlur={() => validateField('propertyType')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'propertyStatus') && (
          <FormField
            label={getFieldLabel(config, 'propertyStatus', 'Property Status')}
            required={isFieldRequired(config, 'propertyStatus')}
            error={errors.propertyStatus}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={propertyStatuses}
                value={formData.propertyStatus}
                disabled={isEdit && !isFieldEditable(config, 'propertyStatus')}
                placeholder="Select Property Status"
                onChange={(val) => setFieldValue('propertyStatus', val)}
                onBlur={() => validateField('propertyStatus')}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </FormSection>
  );
};
