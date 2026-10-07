import React from 'react';
import { User } from '@omniconnect/ui/icons';
import { Combobox, FormField, FormGrid, FormSection, Input } from '@omniconnect/ui';
import { useLeadStore } from '../../store/useLeadStore';
import { PhoneCountryPicker } from './PhoneCountryPicker';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../config/fieldControlRegistry';
import { useShallow } from 'zustand/react/shallow';
import styles from './leadFormSection.module.css';

interface CustomerInformationSectionProps {
  isEdit?: boolean;
}

/**
 * Who the lead is for.
 *
 * Every field here is behind its own `isFieldVisible` guard and takes its label, its required marker
 * and (in the edit drawer) its editability from Field Settings for the chosen product — never from
 * anything hardcoded. That is why the fields are written out one by one rather than looped: each is a
 * different control over a different part of the form state, and the config only decides whether and
 * how it appears.
 */
export const CustomerInformationSection: React.FC<CustomerInformationSectionProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, states: s.states, branches: s.branches, validateField: s.validateField, fieldConfig: s.fieldConfig })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const states = store.states;
  const branches = store.branches;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  /** The edit drawer honours Field Settings' "editable"; the create form always lets you type. */
  const locked = (apiField: string) => isEdit && !isFieldEditable(config, apiField);

  return (
    <FormSection title="Customer Information" icon={<User size={15} />}>
      <FormGrid>
        {isFieldVisible(config, 'customerName') && (
          <FormField
            label={getFieldLabel(config, 'customerName', 'Customer Name')}
            required={isFieldRequired(config, 'customerName')}
            error={errors.customerName}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="text"
                value={formData.customerName}
                disabled={locked('customerName')}
                onChange={(e) => setFieldValue('customerName', e.target.value)}
                onBlur={() => validateField('customerName')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'icNumber') && (
          <FormField
            label={getFieldLabel(config, 'icNumber', 'IC Number')}
            required={isFieldRequired(config, 'icNumber')}
            // The message comes from the field's own format rule in Field Settings, so it already says
            // what shape the number takes — no fixed format hint here to contradict it.
            error={errors.icNumber}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="text"
                value={formData.icNumber}
                disabled={locked('icNumber')}
                onChange={(e) => setFieldValue('icNumber', e.target.value)}
                onBlur={() => validateField('icNumber')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'phoneNumber') && (
          <FormField
            label={getFieldLabel(config, 'phoneNumber', 'Phone')}
            required={isFieldRequired(config, 'phoneNumber')}
            error={errors.phoneNumber}
          >
            {/* Two controls under one name, so the field names a group rather than a single input. */}
            <div className={styles.phoneRow}>
              <PhoneCountryPicker
                value={formData.phoneCountryCode}
                disabled={locked('phoneNumber')}
                onChange={(dialCode) => setFieldValue('phoneCountryCode', dialCode)}
              />
              <Input
                type="tel"
                aria-label={getFieldLabel(config, 'phoneNumber', 'Phone')}
                aria-invalid={errors.phoneNumber ? true : undefined}
                className={styles.phoneNumber}
                value={formData.phoneNumber}
                disabled={locked('phoneNumber')}
                onChange={(e) => setFieldValue('phoneNumber', e.target.value)}
                onBlur={() => validateField('phoneNumber')}
              />
            </div>
          </FormField>
        )}

        {isFieldVisible(config, 'email') && (
          <FormField
            label={getFieldLabel(config, 'email', 'Email')}
            required={isFieldRequired(config, 'email')}
            error={errors.email}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="email"
                value={formData.email}
                disabled={locked('email')}
                onChange={(e) => setFieldValue('email', e.target.value)}
                onBlur={() => validateField('email')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'state') && (
          <FormField
            label={getFieldLabel(config, 'state', 'State')}
            required={isFieldRequired(config, 'state')}
            error={errors.state}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={states}
                value={formData.state}
                disabled={locked('state')}
                placeholder="Select state"
                onChange={(val) => setFieldValue('state', val)}
                onBlur={() => validateField('state')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'branch') && (
          <FormField
            label={getFieldLabel(config, 'branch', 'Preferred Servicing Branch')}
            required={isFieldRequired(config, 'branch')}
            error={errors.preferredBranch}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control.describedBy}
                invalid={control.invalid}
                options={branches}
                value={formData.preferredBranch}
                disabled={locked('branch')}
                placeholder="Select servicing branch"
                emptyMessage="No branch options currently available"
                onChange={(val) => setFieldValue('preferredBranch', val)}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'employerName') && (
          <FormField
            label={getFieldLabel(config, 'employerName', 'Employer Name')}
            required={isFieldRequired(config, 'employerName')}
            error={errors.employerName}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="text"
                value={formData.employerName}
                disabled={locked('employerName')}
                onChange={(e) => setFieldValue('employerName', e.target.value)}
                onBlur={() => validateField('employerName')}
              />
            )}
          </FormField>
        )}

        {isFieldVisible(config, 'appliedAmount') && (
          <FormField
            label={getFieldLabel(config, 'appliedAmount', 'Applied Amount')}
            required={isFieldRequired(config, 'appliedAmount')}
            error={errors.appliedAmount}
          >
            {(control) => (
              <Input
                {...control.aria}
                type="text"
                inputMode="decimal"
                value={formData.appliedAmount}
                disabled={locked('appliedAmount')}
                onChange={(e) => setFieldValue('appliedAmount', e.target.value)}
                onBlur={() => validateField('appliedAmount')}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </FormSection>
  );
};
