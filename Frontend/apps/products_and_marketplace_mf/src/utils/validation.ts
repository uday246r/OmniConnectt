import type { Country } from "../data/countries";
import type { FieldDefinition } from "../types/domain";

export function validateName(name: string): string | null {
  if (!name.trim()) return "Full name is required.";
  if (name.trim().length < 2) return "Name must be at least 2 characters.";
  return null;
}

export function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email address is required.";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) return "Enter a valid email address.";
  return null;
}

export function getMaxPhoneLength(country: Country): number {
  if (!country.phoneLength) return 15;
  if (typeof country.phoneLength === "number") return country.phoneLength;
  if (Array.isArray(country.phoneLength)) return country.phoneLength[1];
  return 15;
}

export function getMinPhoneLength(country: Country): number {
  if (!country.phoneLength) return 7;
  if (typeof country.phoneLength === "number") return country.phoneLength;
  if (Array.isArray(country.phoneLength)) return country.phoneLength[0];
  return 7;
}

export function validatePhone(country: Country, phone: string): string | null {
  if (!phone.trim()) return "Phone number is required.";
  const digitsOnly = phone.replace(/\D/g, "");
  const minDigits = getMinPhoneLength(country);

  if (digitsOnly.length < minDigits) {
    return "Please enter a valid phone number.";
  }

  return null;
}

export function validateDob(dob: string): string | null {
  if (!dob) return "Date of birth is required.";
  const date = new Date(dob);
  if (isNaN(date.getTime())) return "Invalid date.";
  const now = new Date();
  const age = (now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 18) return "Applicant must be at least 18 years old.";
  if (age > 100) return "Enter a valid date of birth.";
  return null;
}

export function validateRequestedAmount(label: string, amount: string): string | null {
  if (!amount || !amount.trim()) return `${label} is required.`;
  const num = parseFloat(amount.replace(/,/g, ""));
  if (isNaN(num) || num <= 0) return `Enter a valid ${label.toLowerCase()}.`;
  return null;
}

export function validateProductField(field: FieldDefinition, value: string): string | null {
  if (field.required && (!value || !value.trim())) {
    return `${field.label} is required.`;
  }
  if (value && (field.dataType === "Number" || field.dataType === "Currency" || field.dataType === "Percentage")) {
    const num = parseFloat(value.replace(/,/g, ""));
    if (isNaN(num)) return `Enter a valid number for ${field.label}.`;
    if (field.dataType === "Percentage" && (num < 0 || num > 100)) {
      return "Percentage must be between 0 and 100.";
    }
  }
  return null;
}
