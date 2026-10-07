import React from 'react';
import { FileText } from '@omniconnect/ui/icons';
import { PageHeader } from '@omniconnect/ui';
import { LeadFormContainer } from '../components/lead/LeadFormContainer';
import shell from '../shared/leadPage.module.css';
import styles from './CreateLeadPage.module.css';

/**
 * Create Lead.
 *
 * The banner is @omniconnect/ui's PageHeader, which replaced a hand-rolled copy of the platform
 * banner — its own gradient, two decorative circles, glass icon tile, title and role chip — that had
 * drifted from the host's on radius, padding, gradient angle and title size. The card below is this
 * app's own `.card`, for the same reason: the global `.form-card` it used to carry was the last
 * thing on this screen still drawing its own chrome.
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

      <div className={styles.formCard}>
        <LeadFormContainer />
      </div>
    </div>
  );
};
