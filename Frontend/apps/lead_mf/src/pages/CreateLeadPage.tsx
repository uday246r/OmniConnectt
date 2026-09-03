import React from 'react';
import { FileText } from '@omniremit/ui/icons';
import { PageHeader } from '@omniremit/ui';
import { LeadFormContainer } from '../components/lead/LeadFormContainer';
import shell from '../shared/leadPage.module.css';
import styles from './CreateLeadPage.module.css';

/**
 * Create Lead.
 *
 * The banner is @omniremit/ui's PageHeader, which replaced a hand-rolled copy of the platform
 * banner — its own gradient, two decorative circles, glass icon tile, title and role chip — that had
 * drifted from the host's on radius, padding, gradient angle and title size.
 */
export const CreateLeadPage: React.FC = () => {
  return (
    <div className={shell.page}>
      <PageHeader
        icon={<FileText size={24} />}
        title="Submit New Lead Application"
        subtitle="Complete all required fields to register a new customer financing enquiry"
        pill="Lead Submission Form"
      />

      <div className={`form-card ${styles.formCard}`}>
        <LeadFormContainer />
      </div>
    </div>
  );
};
