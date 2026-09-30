import React from 'react';
import { Building2 } from '@omniconnect/ui/icons';
import { useLeadStore } from '../../../store/useLeadStore';
import { DatePicker } from '../../common/DatePicker';
import { SearchableDropdown } from '../../common/SearchableDropdown';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../../config/fieldControlRegistry';
import { useShallow } from 'zustand/react/shallow';

interface MicrofinanceFieldsProps {
  isEdit?: boolean;
}

export const MicrofinanceFields: React.FC<MicrofinanceFieldsProps> = ({ isEdit = false }) => {
  const store = useLeadStore(useShallow((s) => ({ editFormData: s.editFormData, formData: s.formData, editErrors: s.editErrors, errors: s.errors, setEditFieldValue: s.setEditFieldValue, setFieldValue: s.setFieldValue, entityTypes: s.entityTypes, validateField: s.validateField, fieldConfig: s.fieldConfig })));
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const entityTypes = store.entityTypes;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  return (
    <div className="form-section">
      <div className="form-section-title">
        <Building2 size={18} className="form-section-icon" />
        <span>Business Details</span>
      </div>

      <div className="form-grid-1">
        {/* Date of Incorporation */}
        {isFieldVisible(config, 'dateOfIncorporation') && (
          <DatePicker
            id="date-of-incorporation-picker"
            label={getFieldLabel(config, 'dateOfIncorporation', 'Date of Incorporation')}
            placeholder="DD/MM/YYYY"
            value={formData.dateOfIncorporation}
            disabled={isEdit && !isFieldEditable(config, 'dateOfIncorporation')}
            onChange={(val) => setFieldValue('dateOfIncorporation', val)}
            required={isFieldRequired(config, 'dateOfIncorporation')}
            error={errors.dateOfIncorporation}
          />
        )}

        {/* Company Name */}
        {isFieldVisible(config, 'companyName') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'companyName', 'Company Name')}{' '}
              {isFieldRequired(config, 'companyName') && <span className="required-asterisk">*</span>}
            </label>
            <input
              type="text"
              className={`form-input ${errors.companyName ? 'has-error' : ''}`}
              value={formData.companyName}
              disabled={isEdit && !isFieldEditable(config, 'companyName')}
              onChange={(e) => setFieldValue('companyName', e.target.value)}
              onBlur={() => validateField('companyName')}
            />
            {errors.companyName && (
              <div className="field-error-message">{errors.companyName}</div>
            )}
          </div>
        )}

        {/* Entity Type */}
        {isFieldVisible(config, 'entityType') && (
          <SearchableDropdown
            label={getFieldLabel(config, 'entityType', 'Entity Type')}
            placeholder="Select Entity Type"
            options={entityTypes}
            value={formData.entityType}
            disabled={isEdit && !isFieldEditable(config, 'entityType')}
            onChange={(val) => setFieldValue('entityType', val)}
            onBlur={() => validateField('entityType')}
            required={isFieldRequired(config, 'entityType')}
            error={errors.entityType}
          />
        )}
      </div>
    </div>
  );
};
