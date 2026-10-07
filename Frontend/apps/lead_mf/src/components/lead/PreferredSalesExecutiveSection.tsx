import React from 'react';
import { UserCheck } from '@omniconnect/ui/icons';
import { Checkbox, Combobox, FormField, FormGrid, FormSection } from '@omniconnect/ui';
import { useLeadStore } from '../../store/useLeadStore';
import { isFieldVisible, isFieldEditable, getFieldLabel } from '../../config/fieldControlRegistry';
import { useShallow } from 'zustand/react/shallow';

interface PreferredSalesExecutiveSectionProps {
  isEdit?: boolean;
}

/**
 * An optional ask: whether the customer wants a particular sales executive, and which one.
 *
 * The dropdown appears only once the box is ticked, and un-ticking it clears the choice rather than
 * leaving a hidden value to be submitted.
 */
export const PreferredSalesExecutiveSection: React.FC<PreferredSalesExecutiveSectionProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, salesExecutives: s.salesExecutives, validateField: s.validateField, fieldConfig: s.fieldConfig })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const salesExecutives = store.salesExecutives;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  const handleCheckboxToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setFieldValue('hasPreferredSalesExecutive', isChecked);
    if (!isChecked) {
      setFieldValue('preferredSalesExecutive', '');
    }
  };

  if (!isFieldVisible(config, 'hasPreferredSalesExecutive')) return null;

  const checkboxLocked = isEdit && !isFieldEditable(config, 'hasPreferredSalesExecutive');
  const label = getFieldLabel(config, 'hasPreferredSalesExecutive', 'Select your preferred Sales Executive');

  return (
    <FormSection title="Sales Executive" icon={<UserCheck size={15} />}>
      <Checkbox
        label={label}
        checked={formData.hasPreferredSalesExecutive}
        disabled={checkboxLocked}
        onChange={handleCheckboxToggle}
      />

      {formData.hasPreferredSalesExecutive && isFieldVisible(config, 'preferredSalesExecutive') && (
        <FormGrid>
          <FormField
            label={getFieldLabel(config, 'preferredSalesExecutive', 'Select your preferred Sales Executive')}
            required
            error={errors.preferredSalesExecutive}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={salesExecutives}
                value={formData.preferredSalesExecutive}
                disabled={isEdit && !isFieldEditable(config, 'preferredSalesExecutive')}
                placeholder="Select Sales Executive"
                emptyMessage="No sales executives currently available"
                onChange={(val) => setFieldValue('preferredSalesExecutive', val)}
                onBlur={() => validateField('preferredSalesExecutive')}
              />
            )}
          </FormField>
        </FormGrid>
      )}
    </FormSection>
  );
};
