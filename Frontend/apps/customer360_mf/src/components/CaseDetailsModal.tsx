import React from 'react';
import { useInteractionStore } from '../store/interactionStore';
import { FileText, User, ShieldAlert } from '@omniremit/ui/icons';
import { Drawer } from '@omniremit/ui';
import { formatValue } from '../shared/formatValue';

export default function CaseDetailsModal() {
  const { selectedCase, modalOpen, closeCaseModal } = useInteractionStore();

  if (!modalOpen || !selectedCase) return null;

  // "-" is a display-only fallback for a missing value — never a sample/demo value.
  return (
    <Drawer
      open={modalOpen}
      onClose={closeCaseModal}
      title="Case Details"
      subtitle="Complete Case Information"
      icon={<FileText size={20} />}
    >
      <div className="drawer-body">
          {/* Section 1: Case Overview */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <FileText size={16} />
              <span>Case Overview</span>
            </div>
            <div className="drawer-section-card">
              <div className="drawer-field-row">
                <span className="info-label">Service</span>
                <span className="info-value">{formatValue(selectedCase.main)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">Sub Category 1</span>
                <span className="info-value">{formatValue(selectedCase.subCategory1)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">Sub Category 2</span>
                <span className="info-value">{formatValue(selectedCase.subCategory2)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">Date Case</span>
                <span className="info-value">{formatValue(selectedCase.dateCase)}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Contact & Identity */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <User size={16} />
              <span>Contact & Identity</span>
            </div>
            <div className="drawer-section-card">
              <div className="drawer-field-row">
                <span className="info-label">Contact No</span>
                <span className="info-value">{formatValue(selectedCase.contactNo)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">IC No</span>
                <span className="info-value">{formatValue(selectedCase.nric)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">State / Branch</span>
                <span className="info-value">{formatValue(selectedCase.stateName)}</span>
              </div>
              <div className="drawer-field-row">
                <span className="info-label">Channel To</span>
                <span className="info-value">{formatValue(selectedCase.channelTo)}</span>
              </div>
            </div>
          </div>

          {/* Section 3: Case Details */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <ShieldAlert size={16} />
              <span>Case Details</span>
            </div>
            <div className="drawer-section-card">
              <div className="drawer-field-row">
                <span className="info-label">Amount Involved</span>
                <span className="info-value">{formatValue(selectedCase.amountInvolved)}</span>
              </div>
            </div>
          </div>
      </div>
    </Drawer>
  );
}
