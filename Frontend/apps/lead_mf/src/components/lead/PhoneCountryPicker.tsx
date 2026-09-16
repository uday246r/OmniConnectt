import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@omniconnect/ui';
import { COUNTRY_PHONE_LIST } from '@omniconnect/ui/validation';
import styles from './PhoneCountryPicker.module.css';

interface PhoneCountryPickerProps {
  /** The dial code, e.g. "+60" — the form and the API both carry the code, not the country. */
  value: string;
  onChange: (dialCode: string) => void;
  disabled?: boolean;
}

/**
 * The country part of a lead's phone number.
 *
 * This was a fixed "🇲🇾 +60" label, so a customer's Singapore or Indian number could only be typed as
 * if it were Malaysian — and then failed Malaysia's digit count. The list is the platform's shared
 * country table, the same one the phone format is checked against, and it can be searched by country
 * name or code.
 */
export function PhoneCountryPicker({ value, onChange, disabled }: PhoneCountryPickerProps) {
  const options = useMemo<ComboboxOption[]>(
    () =>
      COUNTRY_PHONE_LIST.map((country) => ({
        // Several countries share a dial code (+1), so the option is keyed by country and mapped back.
        value: country.code,
        label: country.dialCode,
        description: country.name,
        prefix: <span aria-hidden="true">{country.flag}</span>,
        keywords: `${country.name} ${country.code}`,
      })),
    [],
  );

  const selectedCode = COUNTRY_PHONE_LIST.find((c) => c.dialCode === value)?.code ?? '';

  return (
    <div className={styles.picker}>
      <Combobox
        aria-label="Phone country code"
        options={options}
        value={selectedCode}
        disabled={disabled}
        emptyMessage="No country by that name"
        onChange={(code) => {
          const country = COUNTRY_PHONE_LIST.find((c) => c.code === code);
          if (country) onChange(country.dialCode);
        }}
      />
    </div>
  );
}
