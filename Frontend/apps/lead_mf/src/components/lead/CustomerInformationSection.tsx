import React from 'react';
import { User } from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import { SearchableDropdown } from '../common/SearchableDropdown';
import { isFieldVisible, isFieldRequired, isFieldEditable, getFieldLabel } from '../../config/fieldControlRegistry';
import styles from './CustomerInformationSection.module.css';

interface CustomerInformationSectionProps {
  isEdit?: boolean;
}

/** Renders a `*` only when Field Settings marks the field Required for the currently selected
 * product — never hardcoded. */
function RequiredAsterisk({ show }: { show: boolean }) {
  return show ? <span className="required-asterisk">*</span> : null;
}

export const CustomerInformationSection: React.FC<CustomerInformationSectionProps> = ({ isEdit = false }) => {
  const store = useLeadStore();
  const formData = isEdit ? store.editFormData : store.formData;
  const errors = isEdit ? store.editErrors : store.errors;
  const setFieldValue = isEdit ? store.setEditFieldValue : store.setFieldValue;
  const states = store.states;
  const branches = store.branches;
  const validateField = isEdit ? () => {} : store.validateField;
  const config = store.fieldConfig;

  return (
    <div className="form-section">
      <div className="form-section-title">
        <User size={18} className="form-section-icon" />
        <span>Customer Information</span>
      </div>

      <div className="form-grid-1">
        {/* Customer Name */}
        {isFieldVisible(config, 'customerName') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'customerName', 'Customer Name')} <RequiredAsterisk show={isFieldRequired(config, 'customerName')} />
            </label>
            <input
              type="text"
              className={`form-input ${errors.customerName ? 'has-error' : ''}`}
              value={formData.customerName}
              disabled={isEdit && !isFieldEditable(config, 'customerName')}
              onChange={(e) => setFieldValue('customerName', e.target.value)}
              onBlur={() => validateField('customerName')}
            />
            {errors.customerName && (
              <div className="field-error-message">{errors.customerName}</div>
            )}
          </div>
        )}

        {/* IC Number */}
        {isFieldVisible(config, 'icNumber') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'icNumber', 'IC Number')} <RequiredAsterisk show={isFieldRequired(config, 'icNumber')} />
            </label>
            <input
              type="text"
              className={`form-input ${errors.icNumber ? 'has-error' : ''}`}
              value={formData.icNumber}
              disabled={isEdit && !isFieldEditable(config, 'icNumber')}
              onChange={(e) => setFieldValue('icNumber', e.target.value)}
              onBlur={() => validateField('icNumber')}
            />
            {errors.icNumber && (
              <div className={`field-error-message ${styles.hintSpacer}`}>
                <div>{errors.icNumber}</div>
                <div className={styles.hint}>
                  Format: <span className={styles.monoValue}>YYMMDD-PB-XXXX</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phone */}
        {isFieldVisible(config, 'phoneNumber') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'phoneNumber', 'Phone')} <RequiredAsterisk show={isFieldRequired(config, 'phoneNumber')} />
            </label>
            <div className={`phone-input-container ${errors.phoneNumber ? 'has-error' : ''}`}>
              <div className="phone-prefix-box">
                <span className={styles.largeText}>🇲🇾</span>
                <span>+60</span>
              </div>
              <input
                type="tel"
                className="form-input phone-input-field"
                value={formData.phoneNumber}
                disabled={isEdit && !isFieldEditable(config, 'phoneNumber')}
                onChange={(e) => setFieldValue('phoneNumber', e.target.value)}
                onBlur={() => validateField('phoneNumber')}
              />
            </div>
            {errors.phoneNumber && (
              <div className="field-error-message">{errors.phoneNumber}</div>
            )}
          </div>
        )}

        {/* Email */}
        {isFieldVisible(config, 'email') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'email', 'Email')} <RequiredAsterisk show={isFieldRequired(config, 'email')} />
            </label>
            <input
              type="email"
              className={`form-input ${errors.email ? 'has-error' : ''}`}
              value={formData.email}
              disabled={isEdit && !isFieldEditable(config, 'email')}
              onChange={(e) => setFieldValue('email', e.target.value)}
              onBlur={() => validateField('email')}
            />
            {errors.email && (
              <div className="field-error-message">{errors.email}</div>
            )}
          </div>
        )}

        {/* State */}
        {isFieldVisible(config, 'state') && (
          <SearchableDropdown
            label={getFieldLabel(config, 'state', 'State')}
            placeholder="Select state"
            options={states}
            value={formData.state}
            disabled={isEdit && !isFieldEditable(config, 'state')}
            onChange={(val) => setFieldValue('state', val)}
            onBlur={() => validateField('state')}
            required={isFieldRequired(config, 'state')}
            error={errors.state}
          />
        )}

        {/* Preferred Servicing Branch */}
        {isFieldVisible(config, 'branch') && (
          <SearchableDropdown
            label={getFieldLabel(config, 'branch', 'Preferred Servicing Branch')}
            placeholder="Select servicing branch"
            options={branches}
            value={formData.preferredBranch}
            disabled={isEdit && !isFieldEditable(config, 'branch')}
            onChange={(val) => setFieldValue('preferredBranch', val)}
            required={isFieldRequired(config, 'branch')}
            emptyMessage="No branch options currently available"
          />
        )}

        {/* Employer Name */}
        {isFieldVisible(config, 'employerName') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'employerName', 'Employer Name')} <RequiredAsterisk show={isFieldRequired(config, 'employerName')} />
            </label>
            <input
              type="text"
              className={`form-input ${errors.employerName ? 'has-error' : ''}`}
              value={formData.employerName}
              disabled={isEdit && !isFieldEditable(config, 'employerName')}
              onChange={(e) => setFieldValue('employerName', e.target.value)}
              onBlur={() => validateField('employerName')}
            />
            {errors.employerName && (
              <div className="field-error-message">{errors.employerName}</div>
            )}
          </div>
        )}

        {/* Applied Amount */}
        {isFieldVisible(config, 'appliedAmount') && (
          <div className="form-field-group">
            <label className="form-label">
              {getFieldLabel(config, 'appliedAmount', 'Applied Amount')} <RequiredAsterisk show={isFieldRequired(config, 'appliedAmount')} />
            </label>
            <input
              type="text"
              className={`form-input ${errors.appliedAmount ? 'has-error' : ''}`}
              value={formData.appliedAmount}
              disabled={isEdit && !isFieldEditable(config, 'appliedAmount')}
              onChange={(e) => setFieldValue('appliedAmount', e.target.value)}
              onBlur={() => validateField('appliedAmount')}
            />
            {errors.appliedAmount && (
              <div className="field-error-message">{errors.appliedAmount}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
