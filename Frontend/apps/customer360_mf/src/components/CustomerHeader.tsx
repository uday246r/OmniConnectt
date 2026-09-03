import React from 'react';
import { useCustomerStore } from '../store/customerStore';
import { User, Building2, Phone, Mail, Edit3, Layers, Sparkles } from '@omniremit/ui/icons';
import type { IndividualProfile, CorporateProfile } from '../types/api';
import styles from './CustomerHeader.module.css';
import cc from '../shared/c360Common.module.css';
import { Button } from '@omniremit/ui';

interface CustomerHeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeSubTab?: string;
  setActiveSubTab?: (subTab: string) => void;
}

export default function CustomerHeader({ activeTab, setActiveTab, setActiveSubTab }: CustomerHeaderProps) {
  const { customerType, profile } = useCustomerStore();

  if (!profile) return null;

  const isIndividual = customerType === 'individual';
  const individualProfile = profile as IndividualProfile;
  const corporateProfile = profile as CorporateProfile;

  return (
    <div
      className={styles.panel}
    >
      {/* Upper Row: Profile Avatar, Name, Badges, Tabs */}
      <div className={styles.spread}>
        <div className={styles.row}>
          <div
            className={styles.row2}
          >
            {isIndividual ? <User size={28} /> : <Building2 size={28} />}
          </div>

          <div>
            <h2
              className={styles.text}
            >
              {isIndividual ? individualProfile.fullName : corporateProfile.organizationName}
            </h2>
            <p className={styles.text2}>
              {isIndividual
                ? `Designation: ${individualProfile.designation || '-'}`
                : `${corporateProfile.organizationType || '-'} • ${corporateProfile.country || '-'}`}
            </p>

            {/* Badges */}
            <div className={styles.row3}>
              {isIndividual ? (
                <span
                  className={styles.strong}
                >
                  Status: {individualProfile.flags || 'Active'}
                </span>
              ) : (
                <>
                  <span
                    className={styles.strong2}
                  >
                    {corporateProfile.organizationType || 'Corporate'}
                  </span>
                  <span
                    className={styles.pill}
                  >
                    {corporateProfile.country || 'Malaysia'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        <div className={styles.panel2}>
          {isIndividual ? (
            <>
              <Button
                type="button"
                variant="onHeader"
                size="sm"
                onClick={() => {
                  setActiveTab('details');
                  if (setActiveSubTab) setActiveSubTab('personal');
                }}
                leadingIcon={<User size={14} />}
              >
                Customer Details
              </Button>
              <Button
                type="button"
                variant="onHeader"
                size="sm"
                onClick={() => {
                  setActiveTab('workspace');
                  if (setActiveSubTab) setActiveSubTab('interactions');
                }}
                leadingIcon={<Building2 size={14} />}
              >
                Customer Workspace
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="onHeader"
                size="sm"
                onClick={() => setActiveTab('overview')}
                leadingIcon={<Building2 size={14} />}
              >
                Company Overview
              </Button>
              <Button
                type="button"
                variant="onHeader"
                size="sm"
                onClick={() => setActiveTab('products')}
                leadingIcon={<Layers size={14} />}
              >
                Product Holdings
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className={styles.box} />

      {/* Lower Row: Action Buttons */}
      <div className={styles.row4}>
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Edit3 size={13} />}>
          Edit Profile
        </Button>

        {isIndividual && (
          <>
            <Button type="button" size="sm" leadingIcon={<Phone size={13} />}>
              Call Customer
            </Button>
            <Button type="button" size="sm" leadingIcon={<Mail size={13} />}>
              Send Message
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
