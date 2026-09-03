import React, { useState } from 'react';
import { Building2, Phone, DollarSign, Eye, EyeOff } from '@omniremit/ui/icons';
import type { CorporateProfile, ContactDetail } from '../types/api';
import { maskPhone, maskTIN } from '../utils/masking';
import { api } from '../services/api';
import styles from './CompanyOverview.module.css';
import { formatValue } from '../shared/formatValue';

interface CompanyOverviewProps {
  profile: CorporateProfile | null;
  contactInfo: ContactDetail | null;
}

export default function CompanyOverview({ profile, contactInfo }: CompanyOverviewProps) {
  if (!profile) return null;

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const handleToggleReveal = async (fieldKey: string, fieldLabel: string, realVal: string) => {
    if (!realVal || realVal.trim() === '' || realVal.toLowerCase() === 'null') return;
    const isRevealing = !revealed[fieldKey];
    setRevealed(prev => ({ ...prev, [fieldKey]: isRevealing }));

    if (isRevealing) {
      try {
        await api.logAudit({
          action: "VIEW_SENSITIVE_DATA",
          customerName: profile.organizationName || "Unknown",
          customerType: "Non-Individual",
          field: fieldLabel,
          status: "Success",
          description: `Viewed ${fieldLabel} for customer '${profile.organizationName || "Unknown"}'`,
          customerId: profile.brn || ""
        });
      } catch (err) {
        console.error("Failed to log view sensitive data audit:", err);
      }
    }
  };

  const formatAddress = (val: unknown): string => {
    return formatValue(val);
  };

  return (
    <div className={styles.stack}>
      {/* 3 columns layout: Legal, Financial, Contact */}
      <div className={styles.row}>
        {/* Legal Information Column */}
        <div className={styles.stack2}>
          <h4 className="info-section-title">
            <Building2 size={14} />
            Legal Information
          </h4>

          <div className="info-card">
            <div className="info-label">Company Name</div>
            <div className="info-value">{profile.organizationName || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Business Registration Number</div>
            <div className="info-value">{profile.brn || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Income Tax Number</div>
            <div className={`info-value ${styles.spread}`}>
              <span>{revealed['tin'] ? formatValue(profile.tin) : maskTIN(profile.tin)}</span>
              {profile.tin && profile.tin.trim() !== '' && profile.tin.toLowerCase() !== 'null' && (
                <button
                  onClick={() => handleToggleReveal('tin', 'Income Tax Number', profile.tin!)}
                  className={styles.row2}
                  title={revealed['tin'] ? 'Hide details' : 'Reveal details'}
                >
                  {revealed['tin'] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              )}
            </div>
          </div>

          <div className="info-card">
            <div className="info-label">CIF Number</div>
            <div className="info-value">{profile.cifNumber || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Date of Incorporation</div>
            <div className="info-value">{profile.businessRegDate || '-'}</div>
          </div>
        </div>

        {/* Financial Information Column */}
        <div className={styles.stack2}>
          <h4 className="info-section-title">
            <DollarSign size={14} />
            Financial Information
          </h4>

          <div className="info-card">
            <div className="info-label">Vat Number</div>
            <div className={`info-value ${styles.spread}`}>
              <span>{revealed['vat'] ? formatValue(profile.tin) : maskTIN(profile.tin)}</span>
              {profile.tin && profile.tin.trim() !== '' && profile.tin.toLowerCase() !== 'null' && (
                <button
                  onClick={() => handleToggleReveal('vat', 'Vat Number', profile.tin!)}
                  className={styles.row2}
                  title={revealed['vat'] ? 'Hide details' : 'Reveal details'}
                >
                  {revealed['vat'] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              )}
            </div>
          </div>

          <div className="info-card">
            <div className="info-label">Country</div>
            <div className="info-value">{profile.country || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Economic Sector</div>
            <div className="info-value">{profile.economicSector || '-'}</div>
          </div>
        </div>

        {/* Contact Information Column */}
        <div className={styles.stack2}>
          <h4 className="info-section-title">
            <Phone size={14} />
            Contact Information
          </h4>

          <div className="info-card">
            <div className="info-label">Resident Type</div>
            <div className="info-value">{profile.residentType || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Email</div>
            <div className="info-value">{contactInfo?.padrEmail1 || '-'}</div>
          </div>

          <div className="info-card">
            <div className="info-label">Phone Number</div>
            <div className={`info-value ${styles.spread}`}>
              <span className={styles.rule}>{revealed['phoneCompany'] ? formatValue(contactInfo?.contactNumber) : maskPhone(contactInfo?.contactNumber)}</span>
              {contactInfo?.contactNumber && contactInfo.contactNumber.trim() !== '' && contactInfo.contactNumber.toLowerCase() !== 'null' && (
                <button
                  onClick={() => handleToggleReveal('phoneCompany', 'Company Phone Number', contactInfo.contactNumber!)}
                  className={styles.row2}
                  title={revealed['phoneCompany'] ? 'Hide details' : 'Reveal details'}
                >
                  {revealed['phoneCompany'] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              )}
            </div>
          </div>

          <div className="info-card">
            <div className="info-label">Address</div>
            <div className={`info-value ${styles.rule2}`}>
              {formatAddress(contactInfo?.fixedAddress)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
