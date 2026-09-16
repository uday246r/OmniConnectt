import React from 'react';
import { Home } from '@omniconnect/ui/icons';
import { useLeadStore } from '../../../store/useLeadStore';
import { SearchableDropdown } from '../../common/SearchableDropdown';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../../config/fieldControlRegistry';

interface HomeFinancingFieldsProps {
  isEdit?: boolean;
}

export const HomeFinancingFields: React.FC<HomeFinancingFieldsProps> = ({ isEdit = false }) => {
  const store = useLeadStore();
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const propertyTypes = store.propertyTypes;
  const propertyStatuses = store.propertyStatuses;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  return (
    <div className="form-section">
      <div className="form-section-title">
        <Home size={18} className="form-section-icon" />
        <span>Home Financing Details</span>
      </div>

      <div className="form-grid-2">
        {isFieldVisible(config, 'propertyType') && (
          <SearchableDropdown
            label={getFieldLabel(config, 'propertyType', 'Property Type')}
            placeholder="Select Property Type"
            options={propertyTypes}
            value={formData.propertyType}
            disabled={isEdit && !isFieldEditable(config, 'propertyType')}
            onChange={(val) => setFieldValue('propertyType', val)}
            onBlur={() => validateField('propertyType')}
            required={isFieldRequired(config, 'propertyType')}
            error={errors.propertyType}
          />
        )}

        {isFieldVisible(config, 'propertyStatus') && (
          <SearchableDropdown
            label={getFieldLabel(config, 'propertyStatus', 'Property Status')}
            placeholder="Select Property Status"
            options={propertyStatuses}
            value={formData.propertyStatus}
            disabled={isEdit && !isFieldEditable(config, 'propertyStatus')}
            onChange={(val) => setFieldValue('propertyStatus', val)}
            onBlur={() => validateField('propertyStatus')}
            required={isFieldRequired(config, 'propertyStatus')}
            error={errors.propertyStatus}
          />
        )}
      </div>
    </div>
  );
};
