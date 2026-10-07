import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IndividualDetails from './IndividualDetails';
import { DEFAULT_INDIVIDUAL_FIELD_CONFIGS } from '../constants/defaultFieldConfigs';
import type { FieldConfig, IndividualProfile } from '../types/api';

describe('IndividualDetails', () => {
  it('keeps default fields missing from API config and shows placeholders for missing profile values', () => {
    const partialConfig: FieldConfig[] = [
      {
        ...DEFAULT_INDIVIDUAL_FIELD_CONFIGS.find((field) => field.apiField === 'gender')!,
        displayLabel: 'Customer Gender',
      },
    ];
    const profile: IndividualProfile = {
      phprId: '12345',
      salutation: 'Mr.',
      gender: 'M',
    };

    render(
      <IndividualDetails
        subTab="personal_details"
        profile={profile}
        contactInfo={null}
        fieldConfigs={partialConfig}
      />
    );

    expect(screen.getByText('Salutation')).toBeInTheDocument();
    expect(screen.getByText('Mr.')).toBeInTheDocument();
    expect(screen.getByText('Customer Gender')).toBeInTheDocument();
    expect(screen.getByText('Male')).toBeInTheDocument();
    expect(screen.getByText('Date of Birth')).toBeInTheDocument();
    expect(screen.getAllByText('_').length).toBeGreaterThan(0);
  });
});
