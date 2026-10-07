import React, { useState } from 'react';
import { AlertCircle } from '@omniconnect/ui/icons';
import { Button, Drawer, FormField, Select, TextArea } from '@omniconnect/ui';
import form from '../../shared/formField.module.css';
import { useLeadStore } from '../../store/useLeadStore';
import { useShallow } from 'zustand/react/shallow';

/** Ties the footer's submit button to the form rendered in the Drawer body. */
const FORM_ID = 'edit-reason-form';

const PREDEFINED_REASONS = [
  'Incorrect customer information',
  'Incorrect contact information',
  'Incorrect financial information',
  'Incorrect amount entered',
  'Customer information changed',
  'Correction requested by customer',
  'Data entry mistake',
  'Other',
];

export const EditReasonDrawer: React.FC = () => {
  const { isEditReasonOpen, closeEditReasonDrawer, proceedToEditLead, editLeadTarget } = useLeadStore(useShallow((s) => ({ isEditReasonOpen: s.isEditReasonOpen, closeEditReasonDrawer: s.closeEditReasonDrawer, proceedToEditLead: s.proceedToEditLead, editLeadTarget: s.editLeadTarget })));

  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!isEditReasonOpen || !editLeadTarget) return null;

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();
    const finalReason = selectedReason === 'Other' ? customReason.trim() : (selectedReason.trim() || customReason.trim());

    if (!finalReason) {
      setError('Please select or provide a reason for editing this lead.');
      return;
    }

    setError('');
    proceedToEditLead(finalReason);
  };

  return (
    <Drawer
      open
      onClose={closeEditReasonDrawer}
      title="Edit Lead Information"
      subtitle={`Audit requirement for lead modifications — ${editLeadTarget.name} (${editLeadTarget.icNumber})`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={closeEditReasonDrawer}>
            Cancel
          </Button>
          {/* The form lives in the Drawer body while this button lives in the footer slot, so it is
              associated by id rather than by nesting — same submit behaviour, no wrapper needed. */}
          <Button type="submit" form={FORM_ID}>
            Continue / Proceed
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleProceed}>
            <FormField label="Select Edit Reason" required>
              {(control) => (
                <Select
                  id={control.id}
                  value={selectedReason}
                  onChange={(e) => {
                    setSelectedReason(e.target.value);
                    setError('');
                  }}
                  placeholder="Choose a reason"
                  options={PREDEFINED_REASONS.map((r) => ({ value: r, label: r }))}
                />
              )}
            </FormField>

            {(selectedReason === 'Other' || selectedReason === '') && (
              <FormField
                label={selectedReason === 'Other' ? 'Enter Custom Edit Reason' : 'Or Type Custom Edit Reason'}
                required={selectedReason === 'Other'}
              >
                {(control) => (
                  <TextArea
                    {...control.aria}
                    rows={3}
                    placeholder="Describe the reason for updating this customer's details..."
                    value={customReason}
                    onChange={(e) => {
                      setCustomReason(e.target.value);
                      setError('');
                    }}
                  />
                )}
              </FormField>
            )}

            {error && (
              <div
                className={form.inlineError}
              >
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
      </form>
    </Drawer>
  );
};
