import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@omniconnect/ui";

export interface CustomSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface CustomSelectProps {
  options: readonly (CustomSelectOption | string)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  /** Kept for existing callers; every dropdown on the platform is searchable now. */
  searchable?: boolean;
  "aria-label"?: string;
  id?: string;
}

/**
 * This remote's dropdown, now the platform's shared searchable Combobox.
 *
 * It was a hand-built copy with its own markup, stylesheet and keyboard handling, searchable only past
 * three options, and styled differently from the same control in the host and the other remotes. The
 * props are unchanged, so no caller had to change; the look, keyboard behaviour and accessibility now
 * come from `@omniconnect/ui`.
 */
export function CustomSelect({ options, value, onChange, placeholder = "Select...", disabled, error, className, id, ...aria }: CustomSelectProps) {
  const items = useMemo<ComboboxOption[]>(
    () => options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label, description: o.sublabel })),
    [options],
  );

  return (
    <Combobox
      id={id}
      className={className}
      options={items}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      invalid={error}
      aria-label={aria["aria-label"] ?? placeholder}
    />
  );
}
