import React, { useState } from 'react';
import { Trash2, ArrowLeft } from '@omniconnect/ui/icons';
import { Button, Drawer } from '@omniconnect/ui';
import { useLeadStore } from '../../store/useLeadStore';
import drawerLayout from '../../shared/drawerLayout.module.css';
import form from '../../shared/formField.module.css';
import styles from './DeleteLeadDrawer.module.css';
import { useShallow } from 'zustand/react/shallow';

/** Ties step 1's footer submit button to the reason form rendered in the Drawer body. */
const REASON_FORM_ID = 'delete-lead-reason-form';

export const DeleteLeadDrawer: React.FC = () => {
  const {
    isDeleteReasonOpen,
    isDeleteConfirmOpen,
    deleteLeadTarget,
    deleteReason,
    closeDeleteWorkflow,
    proceedToDeleteConfirm,
    backToDeleteReason,
    confirmDeleteLead,
    isSubmitting,
  } = useLeadStore(useShallow((s) => ({ isDeleteReasonOpen: s.isDeleteReasonOpen, isDeleteConfirmOpen: s.isDeleteConfirmOpen, deleteLeadTarget: s.deleteLeadTarget, deleteReason: s.deleteReason, closeDeleteWorkflow: s.closeDeleteWorkflow, proceedToDeleteConfirm: s.proceedToDeleteConfirm, backToDeleteReason: s.backToDeleteReason, confirmDeleteLead: s.confirmDeleteLead, isSubmitting: s.isSubmitting })));

  const [inputReason, setInputReason] = useState<string>('');
  const [error, setError] = useState<string>('');

  if ((!isDeleteReasonOpen && !isDeleteConfirmOpen) || !deleteLeadTarget) return null;

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputReason.trim()) {
      setError('Delete reason is mandatory. Please enter a justification for deleting this lead.');
      return;
    }
    setError('');
    proceedToDeleteConfirm(inputReason.trim());
  };

  const handleFinalDelete = async () => {
    await confirmDeleteLead();
  };

  return (
    <Drawer
      open
      onClose={closeDeleteWorkflow}
      tone="danger"
      title={isDeleteConfirmOpen ? 'Confirm Lead Deletion' : 'Why do you want to delete this lead?'}
      subtitle={`Lead Reference — ${deleteLeadTarget.name} (${deleteLeadTarget.icNumber})`}
      footer={
        isDeleteConfirmOpen ? (
          <div className={drawerLayout.footerSpread}>
            <Button type="button" variant="secondary" onClick={backToDeleteReason} leadingIcon={<ArrowLeft size={16} />}>
              Back
            </Button>
            <div className={drawerLayout.footerActions}>
              <Button type="button" variant="secondary" onClick={closeDeleteWorkflow}>
                Cancel
              </Button>
              {/* `loading` replaces the previous manual opacity/cursor override and adds the same
                  spinner the host shows on every other in-flight action. */}
              <Button
                type="button"
                variant="danger"
                loading={isSubmitting}
                onClick={handleFinalDelete}
                leadingIcon={<Trash2 size={16} />}
              >
                {isSubmitting ? 'Deleting...' : 'Delete Lead'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteWorkflow}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" form={REASON_FORM_ID}>
              Continue
            </Button>
          </>
        )
      }
    >
      {!isDeleteConfirmOpen ? (
        /* STEP 1: MANDATORY TYPED CUSTOM REASON */
        <form id={REASON_FORM_ID} onSubmit={handleProceed}>


              <div className={`form-group ${form.group}`}>
                <label className={`form-label ${form.label}`}>
                  Enter reason for deleting this lead <span className={form.required}>*</span>
                </label>
                <textarea
                  rows={4}
                  placeholder="Enter reason for deleting this lead..."
                  value={inputReason}
                  onChange={(e) => {
                    setInputReason(e.target.value);
                    setError('');
                  }}
                  className={`${form.control} ${form.controlTall}${error ? ` ${form.controlError}` : ''}`}
                />
                {error && (
                  <div className={form.errorText}>
                    {error}
                  </div>
                )}
              </div>
        </form>
      ) : (
        /* STEP 2: CONFIRMATION STEP WITH LEAD IDENTITY DETAILS */
        <>
              <div className={styles.confirmIntro}>
                <div className={styles.warningMark}>
                  <Trash2 size={28} />
                </div>
                <h3 className={form.sectionHeading}>
                  Are you sure you want to delete this lead?
                </h3>
                <p className={form.sectionText}>
                  Please confirm that you intend to delete the following lead record:
                </p>
              </div>

              {/* Lead Identity Summary Card */}
              <div
                className={`${form.summaryCard} ${styles.summaryCardSpaced}`}
              >
                <div className={form.detailGrid}>
                  <div>
                    <span className={form.detailLabel}>CUSTOMER NAME</span>
                    <strong className={form.detailValue}>{deleteLeadTarget.name}</strong>
                  </div>
                  <div>
                    <span className={form.detailLabel}>IC NUMBER</span>
                    <strong className={form.detailValue}>{deleteLeadTarget.icNumber}</strong>
                  </div>
                  <div>
                    <span className={form.detailLabel}>PRODUCT</span>
                    <strong className={form.detailValue}>{deleteLeadTarget.product}</strong>
                  </div>
                  <div>
                    <span className={form.detailLabel}>PHONE</span>
                    <strong className={form.detailValue}>{deleteLeadTarget.phone}</strong>
                  </div>
                </div>

                <div className={form.detailFooter}>
                  <span className={form.detailLabel}>DELETE REASON</span>
                  <p className={form.reasonQuote}>
                    "{deleteReason}"
                  </p>
                </div>
              </div>
        </>
      )}
    </Drawer>
  );
};
