import React, { useMemo } from 'react';
import { X, Save, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import { CustomerInformationSection } from './CustomerInformationSection';
import { PreferredSalesExecutiveSection } from './PreferredSalesExecutiveSection';
import { HomeFinancingFields } from './ProductSpecificFields/HomeFinancingFields';
import { MicrofinanceFields } from './ProductSpecificFields/MicrofinanceFields';
import { DeclarationConsentSection } from './DeclarationConsentSection';
import { FieldDiff } from '../../types/lead';

export const EditLeadDrawer: React.FC = () => {
  const {
    isEditLeadOpen,
    editLeadTarget,
    editReason,
    editFormData,
    editErrors,
    setEditFieldValue,
    validateEditForm,
    submitEditLead,
    closeEditLeadDrawer,
    isConfirmingEdit,
    setIsConfirmingEdit,
    isSubmitting,
    products,
    fieldConfig,
  } = useLeadStore();

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

    if (form.product === 'Home Financing') {
      compare('Property Type', orig.propertyType, form.propertyType);
      compare('Property Status', orig.propertyStatus, form.propertyStatus);
    } else if (form.product === 'Micro Finance') {
      compare('Date of Incorporation', orig.dateOfIncorporation, form.dateOfIncorporation);
      compare('Company Name', orig.companyName, form.companyName);
      compare('Entity Type', orig.entityType, form.entityType);
    }

    compare('Marketing Consent', orig.marketingConsent, form.marketingConsent);

    return diffs;
  }, [editLeadTarget, editFormData]);

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
    <div className="drawer-overlay" onClick={closeEditLeadDrawer}>
      <div
        className="create-lead-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header-blue">
          <div className="drawer-header-content">
            <h2 className="drawer-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isConfirmingEdit ? 'Confirm Lead Changes' : 'Edit Lead Information'}
            </h2>
            <p className="drawer-subtitle">
              Reason: <span style={{ color: '#dbeafe', fontWeight: 500 }}>"{editReason}"</span>
            </p>
          </div>
          <button
            type="button"
            className="drawer-close-btn"
            onClick={closeEditLeadDrawer}
            aria-label="Close edit drawer"
          >
            <X size={20} />
          </button>
        </div>

        {!isConfirmingEdit ? (
          /* STEP 1: EDIT FORM */
          <form onSubmit={handleSaveClick} style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 130px)' }}>
            <div className="drawer-body" style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
              {/* Product Selection */}
              <div style={{ marginBottom: '24px' }}>
                <label className="form-label" style={{ fontWeight: 600, marginBottom: '8px', display: 'block' }}>
                  Select Financial Product <span style={{ color: '#f43f5e' }}>*</span>
                </label>
                <select
                  value={editFormData.product}
                  onChange={(e) => setEditFieldValue('product', e.target.value)}
                  className="form-input"
                  style={{ appearance: 'auto', cursor: 'pointer', height: '46px' }}
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.value} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {editErrors.product && <div style={{ color: '#f43f5e', fontSize: '12px', marginTop: '4px', fontWeight: 500 }}>{editErrors.product}</div>}
              </div>

              {/* Common Customer Details */}
              <CustomerInformationSection isEdit={true} />

              {/* Preferred Sales Executive */}
              <div style={{ marginTop: '20px' }}>
                <PreferredSalesExecutiveSection isEdit={true} />
              </div>

              {/* Product Specific Fields — config-driven, see LeadFormContainer's identical comment */}
              <div style={{ marginTop: '20px' }}>
                {fieldConfig.some((f) => f.apiField === 'propertyType') && <HomeFinancingFields isEdit={true} />}
                {fieldConfig.some((f) => f.apiField === 'dateOfIncorporation') && <MicrofinanceFields isEdit={true} />}
              </div>

              {/* Declaration & Consent */}
              <div style={{ marginTop: '20px' }}>
                <DeclarationConsentSection isEdit={true} />
              </div>
            </div>

            <div className="drawer-footer">
              <button type="button" className="drawer-btn-cancel" onClick={closeEditLeadDrawer}>
                Cancel
              </button>
              <button type="submit" className="drawer-btn-create">
                <Save size={16} />
                <span>Save Changes</span>
              </button>
            </div>
          </form>
        ) : (
          /* STEP 2: CONFIRMATION DIFF TABLE */
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 130px)' }}>
            <div className="drawer-body" style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '14px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <CheckCircle2 size={22} style={{ color: '#2563eb', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e3a8a' }}>
                    Review Changed Fields Before Persisting
                  </div>
                  <div style={{ fontSize: '13px', color: '#2563eb', marginTop: '2px' }}>
                    The table below highlights only the fields that were modified. Confirming will save changes to the database and generate a backend audit log.
                  </div>
                </div>
              </div>

              {changedFields.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '8px', border: '1px border #e2e8f0' }}>
                  No fields were modified. Click <strong>Save Changes</strong> to exit or <strong>Back</strong> to edit.
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', width: '25%' }}>Field</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#dc2626', width: '37.5%' }}>Previous Value</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#16a34a', width: '37.5%' }}>New Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changedFields.map((diff, index) => (
                        <tr
                          key={diff.field}
                          style={{
                            borderBottom: index === changedFields.length - 1 ? 'none' : '1px solid #e2e8f0',
                            background: index % 2 === 0 ? '#ffffff' : '#f8fafc',
                          }}
                        >
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>{diff.field}</td>
                          <td style={{ padding: '12px 16px', color: '#dc2626', background: '#fef2f2', fontFamily: 'monospace' }}>
                            {diff.previousValue}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#15803d', background: '#f0fdf4', fontFamily: 'monospace', fontWeight: 600 }}>
                            {diff.newValue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="drawer-footer" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="drawer-btn-cancel" onClick={() => setIsConfirmingEdit(false)}>
                <ArrowLeft size={16} />
                <span>Back / Edit</span>
              </button>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="drawer-btn-cancel" onClick={closeEditLeadDrawer}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="drawer-btn-create"
                  disabled={isSubmitting}
                  onClick={handleFinalConfirmSave}
                  style={isSubmitting ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                >
                  <Save size={16} />
                  <span>{isSubmitting ? 'Saving...' : 'Confirm & Save'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
