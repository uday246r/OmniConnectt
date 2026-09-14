import type { ReactNode } from "react";

export function inputClass(baseClass: string, error?: string | null): string {
  if (error) return `${baseClass} pm-input-error`;
  return baseClass;
}

export function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="pm-field">
      <label>
        {label} {required && <span className="pm-required">*</span>}
      </label>
      {children}
      {error && <span className="pm-error-text">{error}</span>}
    </div>
  );
}
