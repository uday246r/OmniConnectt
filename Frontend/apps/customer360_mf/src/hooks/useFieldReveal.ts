import { useState, useCallback } from 'react';

export interface RevealAuditContext {
  customerName: string;
  customerType: 'Individual' | 'Non-Individual';
  customerId: string;
}

/**
 * The reveal-toggle behaviour that used to be hand-rolled independently in IndividualDetails.tsx and
 * CompanyOverview.tsx (identical logic, copy-pasted twice). One shared implementation now backs both
 * of the config-driven detail views.
 *
 * It no longer writes an audit entry, and this is the one place in the platform where removing
 * browser-written audit left a genuine gap rather than closing a hole.
 *
 * The gap is honest, though: the masked and unmasked values are BOTH already in this tab. Masking
 * happens client-side, over a payload the server sent in full, so a "reveal" is a local state
 * change the server never observes and cannot corroborate. The row it used to write attested to
 * nothing — a client that simply declined to send it saw exactly the same data, with no trace.
 *
 * Making the reveal genuinely auditable means masking server-side and fetching the real value
 * through a request the server can record. That is a change to the 360 data contract, not a logging
 * change, and it is deliberately not smuggled in here. Until then this records nothing, which is
 * accurate, rather than something unverifiable, which is worse than silence.
 *
 * The lookup that produced the profile IS audited, server-side, by Customer360Service's
 * ProfileController — so "who accessed this customer's record" is answerable; "which field did they
 * expand once it was on screen" is not.
 */
export function useFieldReveal(_context: RevealAuditContext) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const toggleReveal = useCallback((fieldKey: string, _fieldLabel: string, _realVal: string) => {
    setRevealed((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
  }, []);

  return { revealed, toggleReveal };
}
