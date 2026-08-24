import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import type { CorporateProfile, CustomerProfile, CustomerType, IndividualProfile, ContactDetail } from '../types/api';

// ---------------------------------------------------------------------------
// Request version counters for stale-response prevention — ONE PER CUSTOMER TYPE.
//
// Race condition scenario (without this fix):
//   1. User searches Customer A  → request #1 starts
//   2. User immediately searches Customer B → request #2 starts
//   3. Request #1 arrives late (network delay)
//   4. Customer A data OVERWRITES Customer B in state ← BUG
//
// Fix: each search increments a version counter. A response is only committed
// to state if the version it captured is still the current version.
//
// This USED to be a single shared counter for both Individual and Corporate searches. Since
// Individual and Corporate are two independent, non-conflicting sessions (see the per-type slots
// below), that shared counter meant switching tabs and searching the OTHER type bumped the SAME
// counter — so a still-in-flight Individual response arriving after a Corporate search had started
// got silently discarded (no error, just `return null`), even though nothing about it was actually
// stale. That's what produced the intermittent "data disappears, but only sometimes" bug: it
// depended purely on which of the two unrelated requests happened to resolve last. Two independent
// counters mean an Individual search can never invalidate a Corporate one, or vice versa.
// ---------------------------------------------------------------------------
let _individualSearchVersion = 0;
let _corporateSearchVersion = 0;

// ---------------------------------------------------------------------------
// Active-customer identifier persistence (sessionStorage).
//
// This store (and this module) is exposed as-is to the Host App via Module
// Federation, so this is the one place a fix here benefits both the
// standalone dev shell and the production, host-embedded module.
//
// Root-cause note: profile/product/interaction state lives only in-memory
// (Zustand). A browser refresh re-initializes the JS heap, so `profile`
// resets to null — pages that gate on `profile` then render an empty/"No
// products found" state even though the CRM still has the data. That is NOT
// fixed by caching the old profile (that would show stale data); instead we
// persist only the resolved CRM identifier (NRIC or BRN) — never profile
// fields — and re-fetch fresh data from the CRM on the next mount.
// ---------------------------------------------------------------------------
const ACTIVE_CUSTOMER_STORAGE_KEY = 'omni_c360_active_customer';

export interface SavedCustomer {
  customerType: CustomerType;
  id: string;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    // Some embedding contexts (sandboxed iframes) throw on storage access.
    return null;
  }
}

// Persists only the CRM identifier needed to re-fetch — never cached profile data.
export function saveActiveCustomer(customerType: CustomerType, id: string | null | undefined): void {
  const storage = getSessionStorage();
  if (!storage || !id) return;
  try {
    storage.setItem(ACTIVE_CUSTOMER_STORAGE_KEY, JSON.stringify({ customerType, id }));
  } catch {
    // Storage may be full/unavailable — persistence is best-effort only.
  }
}

export function readSavedCustomer(): SavedCustomer | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACTIVE_CUSTOMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedCustomer> | null;
    if (!parsed || !parsed.id || !parsed.customerType) return null;
    return parsed as SavedCustomer;
  } catch {
    return null;
  }
}

export function clearSavedCustomer(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(ACTIVE_CUSTOMER_STORAGE_KEY);
  } catch {
    // Ignore — nothing meaningful to recover from here.
  }
}

interface CustomerStoreState {
  customerType: CustomerType;
  activeIndividualId: string;
  activeCorporateId: string;

  // ---------------------------------------------------------------------
  // Per-type persistence.
  //
  // Individual and Corporate are two INDEPENDENT search sessions, not one
  // shared slot with a type label on it. Before this, `profile`/`contactInfo`
  // were the only storage — switching customerType necessarily discarded
  // whichever type you were leaving, so searching an individual, checking
  // Non-Individual, then coming back to Individual showed a blank form
  // again. Each type now keeps its own cache; `profile`/`contactInfo` below
  // are kept in sync as a read-only VIEW of whichever cache matches the
  // current `customerType`, so every existing consumer (6 components read
  // `profile`/`contactInfo` directly) needed no changes at all.
  // ---------------------------------------------------------------------
  individualProfile: IndividualProfile | null;
  individualContactInfo: ContactDetail | null;
  corporateProfile: CorporateProfile | null;
  corporateContactInfo: ContactDetail | null;

  /** View of individualProfile or corporateProfile matching `customerType` — never set directly. */
  profile: CustomerProfile | null;
  /** View of individualContactInfo or corporateContactInfo matching `customerType`. */
  contactInfo: ContactDetail | null;
  loading: boolean;
  error: string | null;
  /** HTTP status behind `error`, if any — used to classify the message shown to the user */
  errorStatus: number | undefined | null;

  setCustomerType: (type: CustomerType) => void;
  loadActiveProfile: () => Promise<void>;
  loadProfileById: (id: string, type: string, subtype?: string) => Promise<IndividualProfile | null>;
  loadCorporateProfileById: (id: string, type: string) => Promise<CorporateProfile | null>;
}

export const useCustomerStore = create<CustomerStoreState>((set, get) => ({
  customerType: 'individual', // 'individual' or 'corporate'
  activeIndividualId: '',
  activeCorporateId: '',

  individualProfile: null,
  individualContactInfo: null,
  corporateProfile: null,
  corporateContactInfo: null,

  profile: null,
  contactInfo: null,
  loading: false,
  error: null,
  errorStatus: null,

  setCustomerType: (type) => {
    // Just switch which cached slot is being viewed — never clears either slot, and never
    // auto-refetches. A cached profile for the type being switched TO is shown exactly as it was
    // left; a type with nothing searched yet correctly shows null, which the page already renders
    // as the clean search form. `error` is cleared because it belongs to whatever action last ran,
    // not to a specific type.
    const state = get();
    const cachedProfile = type === 'individual' ? state.individualProfile : state.corporateProfile;
    const cachedContact = type === 'individual' ? state.individualContactInfo : state.corporateContactInfo;
    /*
     * `loading` is cleared for the same reason `error` is: it describes a request for the type being
     * switched AWAY from, and that request can no longer write to the shared view (loadActiveProfile
     * now discards cross-type results). Without this the spinner would hang forever whenever a
     * switch happened while a fetch was still in flight — the request would land, correctly decline
     * to touch the shared fields, and leave `loading` stuck true with nothing left to clear it.
     */
    set({ customerType: type, profile: cachedProfile, contactInfo: cachedContact, error: null, loading: false });
  },

  loadActiveProfile: async () => {
    const { customerType, activeIndividualId, activeCorporateId } = get();
    const hasId = customerType === 'individual' ? !!activeIndividualId : !!activeCorporateId;
    if (!hasId) {
      // Nothing to load yet — wait for user search or saved session restore
      return;
    }
    const version = customerType === 'individual' ? ++_individualSearchVersion : ++_corporateSearchVersion;
    set({ loading: true, error: null });

    try {
      let profileData: CustomerProfile | null = null;
      let contactData: ContactDetail | null = null;

      if (customerType === 'individual') {
        const profileRes = await api.getIndividualProfile(activeIndividualId);
        profileData = (profileRes.data && profileRes.data[0]) || null;
        contactData = (await api.getContactInfo(activeIndividualId)).data;
      } else {
        const profileRes = await api.getCorporateProfile(activeCorporateId);
        profileData = (profileRes.data && profileRes.data[0]) || null;
        const brn = (profileData as CorporateProfile | null)?.brn || activeCorporateId;
        contactData = (await api.getContactInfo(brn, 'CORPORATE')).data;
      }

      // Discard if a newer search of the SAME type was started while this one was in-flight
      const currentVersion = customerType === 'individual' ? _individualSearchVersion : _corporateSearchVersion;
      if (version !== currentVersion) return;

      /*
       * Has the user switched customer TYPE while this request was in flight?
       *
       * The version guard above only detects a newer search of the same type, which left the
       * cross-type race wide open and is the cause of the Individual↔Non-Individual regression:
       * search an Individual, switch to Non-Individual before the response lands, and the individual
       * fetch resolves with its version still current — so the guard passes and the block below
       * writes individual data into `profile`, the shared view field that the (now corporate) page
       * is rendering. The result is one customer type's data displayed under the other's heading.
       *
       * The per-type slot is still safe to fill: it is keyed by type and nothing else reads it right
       * now, so caching it keeps a switch back instant. Only the SHARED view fields — profile,
       * contactInfo, loading, error — must be left to whichever type is actually on screen.
       */
      const stillOnThisType = get().customerType === customerType;

      const sharedView = stillOnThisType
        ? { profile: profileData, contactInfo: contactData, loading: false }
        : {};

      if (customerType === 'individual') {
        set({
          individualProfile: profileData as IndividualProfile | null,
          individualContactInfo: contactData,
          ...sharedView,
        });
      } else {
        set({
          corporateProfile: profileData as CorporateProfile | null,
          corporateContactInfo: contactData,
          ...sharedView,
        });
      }
      if (profileData) {
        const savedId =
          customerType === 'individual'
            ? (profileData as IndividualProfile).nationalId
            : (profileData as CorporateProfile).brn;
        saveActiveCustomer(customerType, savedId);
      }
    } catch (err) {
      const currentVersion = customerType === 'individual' ? _individualSearchVersion : _corporateSearchVersion;
      if (version !== currentVersion) return;
      // Same cross-type guard as the success path: a failed individual lookup must not surface as an
      // error banner over the corporate page the user has already switched to.
      if (get().customerType !== customerType) return;
      const error = err as ApiError;
      set({ error: error.message, errorStatus: error.status, loading: false });
      console.error('Error loading customer profile:', err);
    }
  },

  loadProfileById: async (id, type, subtype = '') => {
    const version = ++_individualSearchVersion;
    set({ loading: true, error: null });
    try {
      const profileRes = await api.getIndividualProfile(id, type, subtype);
      const profileData = (profileRes.data && profileRes.data[0]) || null;
      if (!profileData) {
        throw new Error('No customer found with that search value.');
      }
      const contactRes = await api.getContactInfo(profileData.nationalId as string);
      const contactData = contactRes.data;

      // Discard stale response — user may have triggered another Individual search
      if (version !== _individualSearchVersion) return null;

      set({
        individualProfile: profileData,
        individualContactInfo: contactData,
        // A fresh Individual search always means the operator is looking at Individual right now —
        // reflect it in the view fields too regardless of whatever customerType was active a moment
        // ago (matches the pre-existing behaviour: searching always shows its own result).
        customerType: 'individual',
        profile: profileData,
        contactInfo: contactData,
        activeIndividualId: profileData.nationalId as string,
        loading: false,
      });
      saveActiveCustomer('individual', profileData.nationalId);
      return profileData;
    } catch (err) {
      if (version !== _individualSearchVersion) return null;
      const error = err as ApiError;
      // A failed search (not-found or any other error) used to leave whatever profile was already
      // cached from an EARLIER successful search still in place — the render gate downstream checks
      // `!profile`, so as long as some individual profile from before was still sitting in the store,
      // the page kept showing that stale profile instead of the not-found/error state, on every
      // subsequent failed search and even on a fresh visit to the tab (module-level Zustand store
      // persists across remounts). Clearing it here is what makes a failed search actually look like
      // a failed search, symmetric with Corporate's own path below.
      set({ error: error.message, individualProfile: null, individualContactInfo: null, profile: null, contactInfo: null, loading: false });
      throw err;
    }
  },

  loadCorporateProfileById: async (id, type) => {
    const version = ++_corporateSearchVersion;
    set({ loading: true, error: null });
    try {
      const profileRes = await api.getCorporateProfile(id, type);
      const profileData = (profileRes.data && profileRes.data[0]) || null;
      if (!profileData) {
        throw new Error('No company found with that search value.');
      }
      const contactRes = await api.getContactInfo(profileData.brn as string, 'CORPORATE');
      const contactData = contactRes.data;

      // Discard stale response — user may have triggered another Corporate search
      if (version !== _corporateSearchVersion) return null;

      set({
        corporateProfile: profileData,
        corporateContactInfo: contactData,
        customerType: 'corporate',
        profile: profileData,
        contactInfo: contactData,
        activeCorporateId: profileData.brn as string,
        loading: false,
      });
      saveActiveCustomer('corporate', profileData.brn);
      return profileData;
    } catch (err) {
      if (version !== _corporateSearchVersion) return null;
      const error = err as ApiError;
      // Same fix as loadProfileById's catch above — see its comment for the full rationale.
      set({ error: error.message, corporateProfile: null, corporateContactInfo: null, profile: null, contactInfo: null, loading: false });
      throw err;
    }
  },
}));
