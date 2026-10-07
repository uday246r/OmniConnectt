import React from 'react';
import { Building2 } from '@omniconnect/ui/icons';
import { Combobox, FormField, FormGrid, FormSection, Input } from '@omniconnect/ui';
import { useLeadStore } from '../../../store/useLeadStore';
import { DatePicker } from '../../common/DatePicker';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../../config/fieldControlRegistry';
import { useShallow } from 'zustand/react/shallow';

interface MicrofinanceFieldsProps {
  isEdit?: boolean;
}

/**
 * The business a microfinance lead is about.
 *
 * Shown only when Field Settings has switched one of these fields on for the chosen product — never
 * decided from the product's name (see `LeadFormContainer`).
 */
export const MicrofinanceFields: React.FC<MicrofinanceFieldsProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, entityTypes: s.entityTypes, validateField: s.validateField, fieldConfig: s.fieldConfig })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const entityTypes = store.entityTypes;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  return (
    <FormSection title="Business Details" icon={<Building2 size={15} />}>
      <FormGrid>
        {isFieldVisible(config, 'dateOfIncorporation') && (
          <FormField
            label={getFieldLabel(config, 'dateOfIncorporation', 'Date of Incorporation')}
            required={isFieldRequired(config, 'dateOfIncorporation')}
            error={errors.dateOfIncorporation}
          >
            {(control) => (
              <DatePicker
                id={control.id}
                describedBy={control.describedBy}
                invalid={control.invalid}
                placeholder="DD/MM/YYYY"
                value={formData.dateOfIncorporation}
                disabled={isEdit && !isFieldEditable(config, 'dateOfIncorporation')}
                onChange={(val) => setFieldValue('dateOfIncorporation', val)}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'companyName') && (
          <FormField
            label={getFieldLabel(config, 'companyName', 'Company Name')}
            required={isFieldRequired(config, 'companyName')}
            error={errors.companyName}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="text"
                value={formData.companyName}
                disabled={isEdit && !isFieldEditable(config, 'companyName')}
                onChange={(e) => setFieldValue('companyName', e.target.value)}
                onBlur={() => validateField('companyName')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'entityType') && (
          <FormField
            label={getFieldLabel(config, 'entityType', 'Entity Type')}
            required={isFieldRequired(config, 'entityType')}
            error={errors.entityType}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={entityTypes}
                value={formData.entityType}
                disabled={isEdit && !isFieldEditable(config, 'entityType')}
                placeholder="Select Entity Type"
                onChange={(val) => setFieldValue('entityType', val)}
                onBlur={() => validateField('entityType')}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </FormSection>
  );
};
