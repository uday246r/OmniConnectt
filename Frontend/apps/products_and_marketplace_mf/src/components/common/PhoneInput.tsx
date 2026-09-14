import { COUNTRIES, type Country } from "../../data/countries";
import { getMaxPhoneLength } from "../../utils/validation";
import { CountrySelectDropdown } from "./CountrySelectDropdown";
import { inputClass } from "./FormField";

export interface PhoneValue {
  iso2: string;
  localNumber: string;
}

export function PhoneInput({
  value,
  onChange,
  error,
  placeholder,
}: {
  value: PhoneValue;
  onChange: (val: PhoneValue) => void;
  error?: string | null;
  placeholder?: string;
}) {
  const currentCountry = COUNTRIES.find((c: Country) => c.iso2 === value.iso2) ?? COUNTRIES[0];
  const maxDigits = getMaxPhoneLength(currentCountry);

  const handleCountryChange = (country: Country) => {
    const newMax = getMaxPhoneLength(country);
    const truncated = value.localNumber.slice(0, newMax);
    onChange({ iso2: country.iso2, localNumber: truncated });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, "").slice(0, maxDigits);
    onChange({ ...value, localNumber: digitsOnly });
  };

  return (
    <div className="pm-phone-input-group" style={{ display: "flex", gap: 8, width: "100%" }}>
      <CountrySelectDropdown
        value={value.iso2}
        onChange={handleCountryChange}
      />
      <input
        type="tel"
        className={inputClass("pm-input", error)}
        style={{ flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        maxLength={maxDigits}
        value={value.localNumber}
        onChange={handleInputChange}
      />
    </div>
  );
}
