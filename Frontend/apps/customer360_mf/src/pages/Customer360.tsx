import React, { useEffect, useState, useRef } from 'react';
import { useCustomerStore, readSavedCustomer, clearSavedCustomer } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useProductStore } from '../store/productStore';
import { api, ApiError } from '../services/api';
import { getFriendlyErrorMessage, idTypeToFriendlyLabel } from '../utils/errorMessages';
import { maskPhone, maskNRIC, maskTIN } from '../utils/masking';
import CustomerHeader from '../components/CustomerHeader';
import IndividualDetails from '../components/IndividualDetails';
import SectionContainer from '../components/SectionContainer';
import CaseDetailsModal from '../components/CaseDetailsModal';
import ProductDetailsModal from '../components/ProductDetailsModal';
import DynamicProfileSection, { groupBySection } from '../components/DynamicProfileSection';
import { useFieldReveal } from '../hooks/useFieldReveal';
import { Eye, EyeOff, ChevronRight, ChevronDown, SlidersHorizontal, Building2, Layers, User, Briefcase, Globe, Shield, FileText, Calendar, DollarSign, MapPin, Mail, Phone, TrendingUp, Search, RotateCcw, AlertCircle, Loader2 } from '@omniremit/ui/icons';
import { useHostNavigate } from '../navigation/HostNavigation';
import type {
  IndividualProfile,
  CorporateProfile,
  CustomerProduct,
  Interaction,
  LookupOptions,
  FieldConfig,
} from '../types/api';

import { DEFAULT_INDIVIDUAL_FIELD_CONFIGS, DEFAULT_CORPORATE_FIELD_CONFIGS } from '../constants/defaultFieldConfigs';
import styles from './Customer360.module.css';
import { Button, DataTable, EMPTY_VALUE, PageHeader, ResponsiveRows, getInitials } from '@omniremit/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney } from '../shared/formatValue';


/** One "sub-item" row skeleton — matches .left-tab-btn's real height/padding (10px 14px, 13px text). */
function NavItemSkeleton({ indent = false }: { indent?: boolean }) {
  return (
    <div className={`c360-skel ${styles.treeRow}${indent ? ` ${styles.treeRowIndent}` : ''}`} />
  );
}

/**
 * Matches the real right-side content exactly: SectionContainer's `.section-container` card,
 * `.info-section-title` (the blue left-border header), and `.info-cards-grid` of `.info-card` boxes
 * (icon+label row, then a value line) — not a generic 2-column label/value list, which looked nothing
 * like the real bordered field-card grid once the content actually loaded in.
 */
function InfoSectionSkeleton({ cardCount = 9 }: { cardCount?: number }) {
  return (
    <div className="section-container" aria-hidden="true">
      <div className={`c360-skel c360-skel-text ${styles.spacer}`} />
      <div className="info-cards-grid">
        {Array.from({ length: cardCount }, (_, i) => (
          <div key={i} className={`info-card ${styles.row}`}>
            <div>
              <div className={`c360-skel c360-skel-circle ${styles.box}`} />
              <div className={`c360-skel c360-skel-text ${styles.box2}`} />
            </div>
            <div className={`c360-skel c360-skel-text ${styles.box3}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Left-column skeleton for the Individual profile — matches the real two-level nav exactly
 * (Customer360.tsx's individual .customer-left-column): a "Customer Details" group header + 4
 * indented sub-items, a divider, then a "Customer Workspace" group header + 3 indented sub-items.
 * The previous shared skeleton showed 4 flat bars, nothing like this nested, two-group structure.
 */
function IndividualLeftColumnSkeleton() {
  return (
    <div className={styles.stack}>
      <NavItemSkeleton />
      <div className={styles.stack2}>
        {[0, 1, 2, 3].map((i) => <NavItemSkeleton key={i} indent />)}
      </div>
      <div className={styles.box4} />
      <NavItemSkeleton />
      <div className={styles.stack2}>
        {[0, 1, 2].map((i) => <NavItemSkeleton key={i} indent />)}
      </div>
    </div>
  );
}

/**
 * Left-column skeleton for the Non-Individual (corporate) profile — matches the real flat,
 * non-collapsible 6-item list (Company Overview / Company Information / Contact & Relationship /
 * RM Manager Information / Products & Signatories / Interested Products). The previous shared
 * skeleton only showed 4 generic bars — two items short of the real list.
 */
function NonIndividualLeftColumnSkeleton() {
  return (
    <div className={styles.stack3}>
      {[0, 1, 2, 3, 4, 5].map((i) => <NavItemSkeleton key={i} />)}
    </div>
  );
}

/**
 * Mirrors the real .customer-layout-container shape (avatar + name/title/badge on the left, section
 * cards on the right) — but, critically, the left column now renders the CORRECT nav shape for
 * whichever customer type is being searched, since Individual and Non-Individual have genuinely
 * different nav structures (see IndividualLeftColumnSkeleton / NonIndividualLeftColumnSkeleton docs).
 * `isIndividual` is already known before the profile itself loads (it's the search form's own
 * selection), so there's no reason to guess with one generic shape for both.
 */
function ProfileWorkspaceSkeleton({ isIndividual }: { isIndividual: boolean }) {
  return (
    <div className="customer-layout-container" aria-hidden="true">
      <div className="customer-left-column">
        <div className={`c360-skel c360-skel-circle ${styles.spacer2}`} />
        <div className={`c360-skel c360-skel-text ${styles.spacer3}`} />
        <div className={`c360-skel c360-skel-text ${styles.spacer4}`} />
        <div className={`c360-skel c360-skel-pill ${styles.spacer5}`} />
        <div className={styles.spacer6} />
        {isIndividual ? <IndividualLeftColumnSkeleton /> : <NonIndividualLeftColumnSkeleton />}
      </div>

      <div className="customer-right-column">
        <InfoSectionSkeleton />
      </div>
    </div>
  );
}

export default function Customer360() {
  const { customerType, profile, contactInfo, loading, error, errorStatus, loadActiveProfile } = useCustomerStore();
  const {
    interactions,
    loading: loadingInteractions,
    error: interactionsError,
    errorStatus: interactionsErrorStatus,
    loadInteractions,
    openCaseModal
  } = useInteractionStore();
  const {
    products,
    loading: loadingProducts,
    error: productsError,
    errorStatus: productsErrorStatus,
    loadProducts,
    openProductModal,
    pageNumber,
    pageSize,
    totalCount,
    totalPages,
    setPageNumber,
    setPageSize
  } = useProductStore();

  const navigate = useHostNavigate();

  // Adjust tabs based on customerType
  const isIndividual = customerType === 'individual';

  // Tab states
  const [activeTab, setActiveTab] = useState('personal_details'); // 'personal_details' for Individual; 'overview' for Corporate
  const [activeSubTab, setActiveSubTab] = useState(''); // no longer used for Individual details
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [productsTab, setProductsTab] = useState('held'); // 'held' or 'interested' for Individual

  // ---------------------------------------------------------------------------
  // Bootstrap state — avoids the "flash of the search form" on refresh.
  // ---------------------------------------------------------------------------
  const [bootstrapping, setBootstrapping] = useState(() => !readSavedCustomer());

  // Dynamic Search Options (populated from API)
  const [dropdownOptions, setDropdownOptions] = useState<LookupOptions>({
    idTypes: [
      { value: "Phone", label: "Phone Number" },
      { value: "Name", label: "Full Name" },
      { value: "NRIC", label: "National ID (NRIC)" },
      { value: "SecondaryID", label: "Secondary ID" }
    ],
    secondaryIdTypes: [
      { value: "PASSPORT", label: "Passport" },
      { value: "OLDID", label: "Old IC" },
      { value: "POLICENUMBER", label: "Police ID / Army ID" }
    ],
    corpSearchTypes: [
      { value: "BRN", label: "BRN" },
      { value: "OLDBRN", label: "Old BRN" },
      { value: "COMPANYNAME", label: "Company Name" }
    ]
  });

  // ID Search states for Individual
  const [isSearched, setIsSearched] = useState(false);
  const [searchIdType, setSearchIdType] = useState('');
  const [searchSubtype, setSearchSubtype] = useState('');
  const [searchVal, setSearchVal] = useState('');
  const [searchError, setSearchError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);

  // ID Search states for Corporate (Non-Individual)
  const [isSearchedCorp, setIsSearchedCorp] = useState(false);
  const [corpSearchType, setCorpSearchType] = useState('');
  const [corpSearchVal, setCorpSearchVal] = useState('');
  const [corpSearchError, setCorpSearchError] = useState('');
  const [loadingCorpSearch, setLoadingCorpSearch] = useState(false);

  // Individual Product Held states
  const [indSearchQuery, setIndSearchQuery] = useState('');
  const [indShowFilter, setIndShowFilter] = useState(false);
  const [indTypeFilter, setIndTypeFilter] = useState('');
  const [indStatusFilter, setIndStatusFilter] = useState('');
  const [indShowMode, setIndShowMode] = useState('5');
  const [indCustomSize, setIndCustomSize] = useState<number | string>(5);

  // Corporate (Non-Individual) Product Held states
  const [corpSearchQuery, setCorpSearchQuery] = useState('');
  const [corpShowFilter, setCorpShowFilter] = useState(false);
  const [corpTypeFilter, setCorpTypeFilter] = useState('');
  const [corpStatusFilter, setCorpStatusFilter] = useState('');
  const [corpShowMode, setCorpShowMode] = useState('5');
  const [corpCustomSize, setCorpCustomSize] = useState<number | string>(5);

  // Corporate Subtab toggle for Products & Signatories
  const [corpSubTab, setCorpSubTab] = useState('products');

  // Interactions states
  const [intSearchQuery, setIntSearchQuery] = useState('');
  const [intShowFilter, setIntShowFilter] = useState(false);
  const [intStatusFilter, setIntStatusFilter] = useState('');
  const [intShowMode, setIntShowMode] = useState('5');
  const [intCustomSize, setIntCustomSize] = useState<number | string>(5);
  const [intPageNumber, setIntPageNumber] = useState(1);

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const handleToggleReveal = async (fieldKey: string, fieldLabel: string, realVal: string) => {
    if (!realVal || realVal.trim() === '' || realVal.toLowerCase() === 'null') return;
    const isRevealing = !revealed[fieldKey];
    setRevealed(prev => ({ ...prev, [fieldKey]: isRevealing }));

    if (isRevealing) {
      // `profile` is typed as the CustomerProfile union, but every real call site of this function
      // (the four corporate signatory/TIN/phone reveal buttons) only ever fires with a corporate
      // profile loaded, matching the hardcoded "Non-Individual" label below — narrow explicitly rather
      // than reading `.organizationName`/`.brn` off the union, which TypeScript correctly can't allow.
      const corpProfile = profile as CorporateProfile | null;
      try {
        await api.logAudit({
          action: "VIEW_SENSITIVE_DATA",
          customerName: corpProfile?.organizationName || "Unknown",
          customerType: "Non-Individual",
          field: fieldLabel,
          status: "Success",
          description: `Viewed ${fieldLabel} for customer '${corpProfile?.organizationName || "Unknown"}'`,
          customerId: corpProfile?.brn || ""
        });
      } catch (err) {
        console.error("Failed to log view sensitive data audit:", err);
      }
    }
  };

  useEffect(() => {
    let active = true;
    const fetchOptions = async () => {
      try {
        const res = await api.getSearchOptions();
        if (active && res && res.data) {
          setDropdownOptions(res.data);
        }
      } catch (err) {
        console.error("Failed to load search options from lookups API:", err);
      }
    };
    fetchOptions();
    return () => {
      active = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Field-visibility/masking config the detail pages render from (Field Settings feature). Fetched
  // once, alongside the search-options fetch above — both are effectively static reference data for
  // the lifetime of this component.
  // ---------------------------------------------------------------------------
  const [individualFieldConfigs, setIndividualFieldConfigs] = useState<FieldConfig[]>(DEFAULT_INDIVIDUAL_FIELD_CONFIGS);
  const [corporateFieldConfigs, setCorporateFieldConfigs] = useState<FieldConfig[]>(DEFAULT_CORPORATE_FIELD_CONFIGS);

  useEffect(() => {
    let active = true;
    const fetchFieldConfigs = async () => {
      try {
        const [indRes, corpRes] = await Promise.all([
          api.getFieldConfig('Individual'),
          api.getFieldConfig('Corporate'),
        ]);
        if (!active) return;
        if (indRes?.data) setIndividualFieldConfigs(indRes.data);
        if (corpRes?.data) setCorporateFieldConfigs(corpRes.data);
      } catch (err) {
        console.error('Failed to load field configuration:', err);
      }
    };
    fetchFieldConfigs();
    return () => {
      active = false;
    };
  }, []);

  const corpFieldReveal = useFieldReveal({
    customerName: (profile as CorporateProfile | null)?.organizationName || 'Unknown',
    customerType: 'Non-Individual',
    customerId: (profile as CorporateProfile | null)?.brn || '',
  });

  // ---------------------------------------------------------------------------
  // Rehydrate the active customer after a browser refresh.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // The store already has a cached profile for the currently active type — this is the case on
    // every remount of this component that ISN'T a real browser refresh, e.g. navigating to Audit
    // Logs and back to Individual/Non-Individual. MainLayout swaps <Customer360/> out for a
    // different component and back, which unmounts and remounts this component and resets its local
    // state (isSearched/isSearchedCorp default back to false) — but useCustomerStore is a
    // module-level singleton, so `profile` itself is still populated the whole time. Without this,
    // the render gate below (`!isSearched || !profile`) would show the empty search form even though
    // the profile data never actually went away, and only a full page refresh (which re-runs the
    // saved-id refetch path below and sets isSearched itself) would bring it back.
    if (profile) {
      if (customerType === 'individual') {
        setIsSearched(true);
      } else {
        setIsSearchedCorp(true);
      }
      setBootstrapping(false);
      return;
    }
    const saved = readSavedCustomer();
    if (!saved) { setBootstrapping(false); return; }

    // This app has no real URL routing for customer type — navigation is pure in-memory state
    // (setCustomerType, called by the sidebar nav before this component mounts). Gate rehydration on
    // that live `customerType` directly rather than guessing from window.location.pathname (which
    // never actually contains a customer-type segment): comparing against a value that's always
    // 'individual' let a stale Individual snapshot rehydrate and overwrite a just-set 'corporate'
    // customerType, leaking Individual's search result onto the Non-Individual page.
    if (saved.customerType !== customerType) {
      setBootstrapping(false);
      return;
    }

    if (saved.customerType === 'individual') {
      const { loadProfileById } = useCustomerStore.getState();
      loadProfileById(saved.id, 'NRIC')
        .then((loaded) => { if (loaded) setIsSearched(true); })
        .catch(() => clearSavedCustomer())
        .finally(() => setBootstrapping(false));
    } else if (saved.customerType === 'corporate') {
      const { loadCorporateProfileById } = useCustomerStore.getState();
      loadCorporateProfileById(saved.id, 'BRN')
        .then((loaded) => {
          if (loaded) {
            setIsSearchedCorp(true);
          }
        })
        .catch(() => clearSavedCustomer())
        .finally(() => setBootstrapping(false));
    }
  }, []);

  // Read tab from URL query param (used when navigating back)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(window.location.search);
    const tabParam = searchParams.get('tab');
    if (tabParam && profile) {
      let resolvedTab = tabParam;
      if (['residency_details', 'contact_details', 'residency_contact_details', 'residency', 'contact'].includes(tabParam)) {
        resolvedTab = 'residency_contact_details';
        setDetailsExpanded(true);
      } else if (['personal_details', 'personal'].includes(tabParam)) {
        resolvedTab = 'personal_details';
        setDetailsExpanded(true);
      } else if (['employment_details', 'employment'].includes(tabParam)) {
        resolvedTab = 'employment_details';
        setDetailsExpanded(true);
      } else if (['additional_details', 'referrer_relationship', 'additional_relationship_details', 'additional', 'relationship'].includes(tabParam)) {
        resolvedTab = 'additional_relationship_details';
        setDetailsExpanded(true);
      } else if (['contact', 'referral', 'contact_relationship'].includes(tabParam)) {
        resolvedTab = 'contact_relationship';
      } else if (['products', 'signatories', 'products_signatories'].includes(tabParam)) {
        resolvedTab = 'products_signatories';
        setCorpSubTab(tabParam === 'signatories' ? 'signatories' : 'products');
      }
      setActiveTab(resolvedTab);
      if (customerType === 'individual') {
        setIsSearched(true);
      } else {
        setIsSearchedCorp(true);
      }
    }
  }, [profile]);

  const handleSearch = async () => {
    if (!searchIdType || !searchVal) return;
    setLoadingSearch(true);
    setSearchError('');
    try {
      const { loadProfileById } = useCustomerStore.getState();

      let apiType = searchIdType;
      if (searchIdType === 'Phone') apiType = 'PHONENO';
      if (searchIdType === 'Name') apiType = 'FULLNAME';
      if (searchIdType === 'SecondaryID') apiType = 'SECONDARYID';

      const loadedProfile = await loadProfileById(searchVal, apiType, searchSubtype);
      // `loadedProfile` is null when the store's own staleness guard silently discarded this
      // response (a newer Individual search was fired before this one resolved) — NOT a real
      // failure. Only flip to the "profile loaded" view, and only log success, when a profile
      // actually came back; otherwise leave it to whichever search superseded this one.
      if (loadedProfile) {
        setIsSearched(true);

        // Log success
        await api.logAudit({
          action: "SEARCH",
          customerName: loadedProfile.fullName || searchVal,
          customerType: "Individual",
          status: "Success",
          description: `Searched for '${searchVal}' by ${searchIdType}`,
          customerId: loadedProfile.nationalId || searchVal
        }).catch(e => console.error("Search audit error:", e));
      }

    } catch (err) {
      const error = err as ApiError;
      const idLabel = idTypeToFriendlyLabel(searchIdType, searchSubtype);
      setSearchError(getFriendlyErrorMessage(error, 'individual-search', error?.status === 400 ? idLabel : ''));

      // Log failure
      await api.logAudit({
        action: "SEARCH",
        customerName: searchVal,
        customerType: "Individual",
        status: "Failed",
        description: `Failed search for '${searchVal}' by ${searchIdType}`,
        customerId: searchVal
      }).catch(e => console.error("Search audit error:", e));

    } finally {
      setLoadingSearch(false);
    }
  };

  const handleCorpSearch = async () => {
    if (!corpSearchType || !corpSearchVal) return;
    setLoadingCorpSearch(true);
    setCorpSearchError('');
    try {
      // loadCorporateProfileById fetches the profile once and reuses it — calling
      // getCorporateProfile here too (then loadActiveProfile again) previously
      // fired two identical /v1/corpprofile requests per search.
      const { loadCorporateProfileById } = useCustomerStore.getState();
      const loadedProfile = await loadCorporateProfileById(corpSearchVal, corpSearchType);
      // Same reasoning as handleSearch above: null here means the store's staleness guard
      // discarded this response because a newer Corporate search superseded it — not a failure.
      if (loadedProfile) {
        setIsSearchedCorp(true);

        // Log success
        await api.logAudit({
          action: "SEARCH",
          customerName: loadedProfile.organizationName || corpSearchVal,
          customerType: "Non-Individual",
          status: "Success",
          description: `Searched for '${corpSearchVal}' by ${corpSearchType}`,
          customerId: loadedProfile.brn || corpSearchVal
        }).catch(e => console.error("Search audit error:", e));
      }

    } catch (err) {
      const error = err as ApiError;
      const idLabel = idTypeToFriendlyLabel(corpSearchType);
      setCorpSearchError(getFriendlyErrorMessage(error, 'corporate-search', error?.status === 400 ? idLabel : ''));

      // Log failure
      await api.logAudit({
        action: "SEARCH",
        customerName: corpSearchVal,
        customerType: "Non-Individual",
        status: "Failed",
        description: `Failed search for '${corpSearchVal}' by ${corpSearchType}`,
        customerId: corpSearchVal
      }).catch(e => console.error("Search audit error:", e));

    } finally {
      setLoadingCorpSearch(false);
    }
  };

  // Resets all individual search state and returns user to the clean search form.
  // Must clear every credential input so there is no leakage on re-entry.
  // "New Search" — this is the ONLY action that clears Individual's cached profile/search form.
  // Switching away to Non-Individual and back must NOT trigger this (see the removed effect below).
  const handleBackToSearch = () => {
    setIsSearched(false);
    setSearchIdType('');
    setSearchSubtype('');
    setSearchVal('');
    setSearchError('');
    clearSavedCustomer();
    useCustomerStore.setState({
      individualProfile: null,
      individualContactInfo: null,
      profile: null,
      contactInfo: null,
      error: null,
      activeIndividualId: '',
    });
    useProductStore.setState({ products: [], pageNumber: 1, pageSize: 5 });
    useInteractionStore.setState({ interactions: [], pageNumber: 1 });
  };

  // Resets all corporate search state and returns user to the clean corporate search form. Same
  // "only an explicit action clears it" rule as handleBackToSearch above.
  const handleBackToSearchCorp = () => {
    setIsSearchedCorp(false);
    setCorpSearchType('');
    setCorpSearchVal('');
    setCorpSearchError('');
    clearSavedCustomer();
    useCustomerStore.setState({
      corporateProfile: null,
      corporateContactInfo: null,
      profile: null,
      contactInfo: null,
      error: null,
      activeCorporateId: '',
    });
    useProductStore.setState({ products: [], pageNumber: 1, pageSize: 5 });
    useInteractionStore.setState({ interactions: [], pageNumber: 1 });
  };

  // Deliberately no useEffect on [customerType] here anymore. There used to be one that reset the
  // OTHER tab's search form and BOTH tabs' profile every time customerType changed — meaning
  // searching Individual, checking Non-Individual, then coming back to Individual always landed back
  // on a blank form. useCustomerStore.setCustomerType now switches which cached per-type slot is
  // being viewed without clearing either one; each tab's own local state here
  // (isSearched/searchIdType/... vs isSearchedCorp/corpSearchType/...) was ALREADY independent per
  // type and only ever got wiped by this effect. Products/Interactions still refresh for whichever
  // profile is now active via their own [profile, isIndividual] effects further below — that's a
  // deliberate re-fetch-on-switch, not a cache, since the user's complaint was specifically about
  // search state and profile data disappearing, not about an extra network request.

  // Load interactions when profile changes
  useEffect(() => {
    if (profile) {
      const customerId = isIndividual ? (profile as IndividualProfile).nationalId : (profile as CorporateProfile).brn;
      loadInteractions(customerId as string);
    }
  }, [profile, isIndividual]);

  // Load products based on profile and store pagination state
  const lastParamsRef = useRef<{ customerId: string | null | undefined; pageNumber: number | null; pageSize: number | null }>({ customerId: null, pageNumber: null, pageSize: null });

  useEffect(() => {
    if (profile) {
      const customerId = isIndividual ? (profile as IndividualProfile).nationalId : (profile as CorporateProfile).brn;
      const isNewCustomer = lastParamsRef.current.customerId !== customerId;

      // A new customer always needs a fresh fetch at page 1 — full stop.
      // This is handled as its own branch (rather than falling through to
      // the "did page/size change" guard below) specifically because that
      // guard was comparing the NEW target page/size (always 1/5 for a new
      // customer) against lastParamsRef's LEFTOVER page/size from the
      // *previous* customer. Since 1/5 is also the common default, a second
      // customer searched in the same session whose previous customer also
      // happened to be sitting at page 1/size 5 would match on all three
      // guard conditions and incorrectly skip the fetch entirely — Products
      // Held would show "No products found" until something else (e.g. a
      // full refresh, which resets this ref) forced a re-fetch.
      if (isNewCustomer) {
        lastParamsRef.current = { customerId, pageNumber: 1, pageSize: 5 };
        if (pageNumber !== 1 || pageSize !== 5) {
          useProductStore.setState({ pageNumber: 1, pageSize: 5 });
        }
        loadProducts(customerId as string, 1, 5);
        return;
      }

      // Same customer — only re-fetch if the page/size actually changed
      // since the last fetch we issued for them.
      if (lastParamsRef.current.pageNumber === pageNumber && lastParamsRef.current.pageSize === pageSize) {
        return;
      }

      lastParamsRef.current.pageNumber = pageNumber;
      lastParamsRef.current.pageSize = pageSize;
      loadProducts(customerId as string, pageNumber, pageSize);
    }
  }, [profile, pageNumber, pageSize, isIndividual]);

  // Reset filter and search states when customer profile changes
  useEffect(() => {
    setIndSearchQuery('');
    setIndShowFilter(false);
    setIndTypeFilter('');
    setIndStatusFilter('');
    setIndShowMode('5');
    setIndCustomSize(5);

    setCorpSearchQuery('');
    setCorpShowFilter(false);
    setCorpTypeFilter('');
    setCorpStatusFilter('');
    setCorpShowMode('5');
    setCorpCustomSize(5);

    setIntSearchQuery('');
    setIntShowFilter(false);
    setIntStatusFilter('');
    setIntShowMode('5');
    setIntCustomSize(5);
    setIntPageNumber(1);
  }, [profile]);

  useEffect(() => {
    // Skip default tab reset when navigating back with a tab query param
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get('tab');
      if (tabParam) return;
    }

    if (isIndividual) {
      setActiveTab('personal_details');
      setActiveSubTab('');
    } else {
      setActiveTab('overview');
      setActiveSubTab('');
    }
  }, [customerType]);

  // Restoring a customer after refresh — show a neutral loading state, never
  // the search form (which would flash briefly before swapping to the
  // restored workspace) and never a stale/empty table.
  if (bootstrapping) {
    return <ProfileWorkspaceSkeleton isIndividual={isIndividual} />;
  }

  // CustomerProduct's real CRM field is `accountNumber` (see types/api.ts) —
  // `accountNo` was never part of the contract, so this fallback has always
  // been dead at runtime. Preserved via cast rather than "fixed", per the
  // migration's no-behavior-change rule (mirrors the `sourcename`/`source`
  // preservation below for Interaction).
  const getLegacyProductField = (item: CustomerProduct, key: string): string | undefined =>
    (item as unknown as Record<string, string | undefined>)[key];

  // Interaction's real CRM fields are `statusParent` (no plain `status`) and
  // `sourceName` (no plain `source`) — see types/api.ts. Same preservation
  // rationale as getLegacyProductField above.
  const getLegacyInteractionField = (item: Interaction, key: string): string | undefined =>
    (item as unknown as Record<string, string | undefined>)[key];

  // Get filtered products, unique types, and unique statuses for Individual and Non-Individual product lists
  const getFilteredAndUnique = (isInd: boolean) => {
    // 1. Unique Types & Statuses (derived from the original complete list of products loaded in the store)
    const rawTypes = products.map(p => p.type || p.productCategory || '').filter(Boolean);
    const rawStatuses = products.map(p => p.derivedAccountStatus || p.financingStatus || '').filter(Boolean);
    const uniqueTypes = Array.from(new Set(rawTypes));
    const uniqueStatuses = Array.from(new Set(rawStatuses));

    // 2. Filter products
    const query = (isInd ? indSearchQuery : corpSearchQuery).toLowerCase().trim();
    const typeF = isInd ? indTypeFilter : corpTypeFilter;
    const statusF = isInd ? indStatusFilter : corpStatusFilter;

    const filtered = products.filter(item => {
      const matchesSearch = !query ||
        (item.productName || '').toLowerCase().includes(query) ||
        (item.accountNumber || getLegacyProductField(item, 'accountNo') || '').toLowerCase().includes(query) ||
        (item.type || item.productCategory || '').toLowerCase().includes(query);

      const matchesType = !typeF || (item.type || item.productCategory || '') === typeF;
      const matchesStatus = !statusF || (item.derivedAccountStatus || item.financingStatus || '') === statusF;

      return matchesSearch && matchesType && matchesStatus;
    });

    return { filtered, uniqueTypes, uniqueStatuses };
  };

  const indData = getFilteredAndUnique(true);
  const corpData = getFilteredAndUnique(false);

  const getFilteredInteractions = () => {
    const query = intSearchQuery.toLowerCase().trim();
    const statusF = intStatusFilter;

    // 1. Filter interactions
    const filtered = interactions.filter(item => {
      const matchesSearch = !query ||
        (item.caseId || '').toLowerCase().includes(query) ||
        (item.category || '').toLowerCase().includes(query) ||
        (getLegacyInteractionField(item, 'status') || item.statusParent || '').toLowerCase().includes(query) ||
        (getLegacyInteractionField(item, 'source') || item.sourceName || '').toLowerCase().includes(query) ||
        (item.classification || item.subCategory1 || '').toLowerCase().includes(query);

      const matchesStatus = !statusF || (getLegacyInteractionField(item, 'status') || item.statusParent || '') === statusF;

      return matchesSearch && matchesStatus;
    });

    // 2. Unique statuses
    const uniqueStatuses = Array.from(new Set(interactions.map(item => getLegacyInteractionField(item, 'status') || item.statusParent || '').filter(Boolean)));

    return { filtered, uniqueStatuses };
  };

  const intData = getFilteredInteractions();

  const getIntPageSize = () => {
    if (intShowMode === '5') return 5;
    if (intShowMode === '10') return 10;
    if (intShowMode === 'custom') {
      const size = parseInt(String(intCustomSize), 10);
      return (!isNaN(size) && size > 0) ? size : 5;
    }
    return intData.filtered.length || 5;
  };

  const intPageSize = getIntPageSize();
  const intTotalPages = Math.ceil(intData.filtered.length / intPageSize) || 1;
  const safeIntPageNumber = Math.min(intPageNumber, intTotalPages);

  const paginatedInteractions = intData.filtered.slice(
    (safeIntPageNumber - 1) * intPageSize,
    safeIntPageNumber * intPageSize
  );
  // formatValue/formatCurrency live in src/shared — formatValue alone had been copied
  // verbatim into four components. Currency follows the corporate profile's country.
  const formatCurrency = (val: unknown) =>
    formatMoney(val, (profile as CorporateProfile | null)?.country);

  const renderIndividualSearchPanel = () => (
    <>
      {/* The page banner is the platform PageHeader — the same component the host's Audit Logs and
          Approval Center render, and lead_mf's dashboard. This page used to carry its own copy that
          drifted on gradient angle and title size. */}
      <PageHeader
        icon={<User size={24} />}
        title="Individual Customer Search"
        subtitle={
          !searchIdType ? 'Select an ID type and enter value to look up customer profile.' :
          searchIdType === 'Phone' ? 'Search customer by phone number.' :
          searchIdType === 'Name' ? 'Search customer by full registered name.' :
          searchIdType === 'NRIC' ? 'Search customer by National ID (NRIC).' :
          `Search customer by ${(dropdownOptions.secondaryIdTypes.find(opt => opt.value === searchSubtype)?.label || 'secondary document')}.`
        }
        actions={
          isSearched ? (
            <Button variant="onHeader" onClick={handleBackToSearch} leadingIcon={<RotateCcw size={14} />}>
              New Search
            </Button>
          ) : undefined
        }
      />

      <div className={`c360-search-panel ${styles.spacer7}`}>
      <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
        <div className="c360-search-form-row">
          {/* ID Type Select */}
          <div className="c360-form-group">
            <label className="c360-label">
              Search By <span className="c360-required">*</span>
            </label>
            <select
              value={searchIdType}
              onChange={(e) => {
                setSearchIdType(e.target.value);
                setSearchSubtype('');
                setSearchVal('');
                setSearchError('');
              }}
              className="c360-select"
            >
              <option value="">Select ID Type</option>
              {dropdownOptions.idTypes.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Secondary ID Type Select */}
          {searchIdType === 'SecondaryID' ? (
            <div className="c360-form-group">
              <label className="c360-label">
                Document Type <span className="c360-required">*</span>
              </label>
              <select
                value={searchSubtype}
                onChange={(e) => {
                  setSearchSubtype(e.target.value);
                  setSearchVal('');
                  setSearchError('');
                }}
                className="c360-select"
              >
                <option value="">Select Document</option>
                {dropdownOptions.secondaryIdTypes.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className={styles.rule} />
          )}

          {/* Search Input — only once the operator has actually chosen what they're searching by.
              Showing an empty "Identity Number" box before any ID Type is selected (previously
              unconditional) told the operator nothing about what format to enter and read as
              confusing/broken; for Secondary ID specifically, the document type must be picked too,
              since the placeholder/label below depends on it. */}
          {searchIdType && (searchIdType !== 'SecondaryID' || searchSubtype) && (
            <div className={`c360-form-group ${searchIdType === 'SecondaryID' ? styles.searchSpanNarrow : styles.searchSpan}`}>
              <label className="c360-label">
                {searchIdType === 'Phone' ? 'Phone Number' :
                 searchIdType === 'Name' ? 'Full Name' :
                 searchIdType === 'NRIC' ? 'National ID (NRIC)' :
                 (dropdownOptions.secondaryIdTypes.find((opt) => opt.value === searchSubtype)?.label || 'Identity Number')} <span className="c360-required">*</span>
              </label>
              <div className="c360-input-wrapper">
                <Search size={16} className="c360-input-icon" />
                <input
                  type="text"
                  placeholder={
                    searchIdType === 'Phone' ? 'e.g. +60123456789 or 0123456789' :
                    searchIdType === 'Name' ? 'e.g. Ahmad bin Razak' :
                    searchIdType === 'NRIC' ? 'e.g. 900101-14-5566 or 900101145566' :
                    searchSubtype === 'PASSPORT' ? 'e.g. A12345678' : 'Enter identity number'
                  }
                  value={searchVal}
                  onChange={(e) => {
                    setSearchVal(e.target.value);
                    setSearchError('');
                  }}
                  className="c360-input"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <Button
            type="submit"
            loading={loadingSearch}
            disabled={!searchIdType || !searchVal}
            leadingIcon={<Search size={15} />}
          >
            {loadingSearch ? 'Searching...' : 'Search Profile'}
          </Button>
        </div>

        {searchError && (
          <div className={styles.row3}>
            <AlertCircle size={15} />
            {searchError}
          </div>
        )}
      </form>
      </div>
    </>
  );

  const renderCorporateSearchPanel = () => (
    <>
      <PageHeader
        icon={<Building2 size={24} />}
        title="Non-Individual (Corporate) Search"
        subtitle={
          !corpSearchType ? 'Select a search type and enter a value to look up a company profile.' :
          corpSearchType === 'BRN' ? 'Search registered company by Business Registration Number (BRN).' :
          corpSearchType === 'OLDBRN' ? 'Search registered company by Old BRN.' :
          'Search registered company by Company Name.'
        }
        actions={
          isSearchedCorp ? (
            <Button variant="onHeader" onClick={handleBackToSearchCorp} leadingIcon={<RotateCcw size={14} />}>
              New Search
            </Button>
          ) : undefined
        }
      />

      <div className={`c360-search-panel ${styles.spacer7}`}>
      <form onSubmit={(e) => { e.preventDefault(); handleCorpSearch(); }}>
        <div className="c360-search-form-row">
          {/* Search Type Select */}
          <div className="c360-form-group">
            <label className="c360-label">
              Search Type <span className="c360-required">*</span>
            </label>
            <select
              value={corpSearchType}
              onChange={(e) => {
                setCorpSearchType(e.target.value);
                setCorpSearchVal('');
                setCorpSearchError('');
              }}
              className="c360-select"
            >
              <option value="">Select Search Type</option>
              {dropdownOptions.corpSearchTypes.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input — only once a search type is actually chosen. Previously unconditional,
              which meant it fell through to the "Company / Organization Name" branch (the ternary's
              else case) even with nothing selected — indistinguishable from genuinely having chosen
              Company Name search. */}
          {corpSearchType && (
            <div className={`c360-form-group ${styles.rule2}`}>
              <label className="c360-label">
                {corpSearchType === 'BRN' ? 'BRN (Business Registration Number)' :
                 corpSearchType === 'OLDBRN' ? 'Old Registration Number' :
                 'Company / Organization Name'} <span className="c360-required">*</span>
              </label>
              <div className="c360-input-wrapper">
                <Search size={16} className="c360-input-icon" />
                <input
                  type="text"
                  placeholder={
                    corpSearchType === 'BRN' ? 'e.g. 202003150001' :
                    corpSearchType === 'OLDBRN' ? 'e.g. 202003151A' :
                    'e.g. Omni Global Trading Sdn Bhd'
                  }
                  value={corpSearchVal}
                  onChange={(e) => {
                    setCorpSearchVal(e.target.value);
                    setCorpSearchError('');
                  }}
                  className="c360-input"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <Button
            type="submit"
            loading={loadingCorpSearch}
            disabled={!corpSearchType || !corpSearchVal}
            leadingIcon={<Search size={15} />}
          >
            {loadingCorpSearch ? 'Searching...' : 'Search Company'}
          </Button>
        </div>

        {corpSearchError && (
          <div className={styles.row3}>
            <AlertCircle size={15} />
            {corpSearchError}
          </div>
        )}
      </form>
      </div>
    </>
  );

  /*
   * `loading` is checked FIRST, before anything else, and for BOTH customer types identically: the
   * search panel/hero stays visible (never replaced), and ONLY the results area below it — the exact
   * space the real profile is about to render into — gets ProfileWorkspaceSkeleton. This applies
   * equally whether it's the very first search (no profile yet) or a reload of an already-loaded
   * profile, so there's exactly one loading presentation, not two different ones depending on when
   * loading happens to become true.
   */
  if (loading) {
    return (
      <div>
        {isIndividual ? renderIndividualSearchPanel() : renderCorporateSearchPanel()}
        <ProfileWorkspaceSkeleton isIndividual={isIndividual} />
      </div>
    );
  }

  // Not yet searched, and nothing loaded — for EITHER customer type. This used to only check
  // `isIndividual`, so Corporate had no equivalent and fell through to a bare, page-replacing
  // skeleton instead of keeping its own search panel visible here.
  if ((isIndividual && (!isSearched || !profile)) || (!isIndividual && (!isSearchedCorp || !profile))) {
    return (
      <div>
        {isIndividual ? renderIndividualSearchPanel() : renderCorporateSearchPanel()}
        <div className="c360-empty-prompt">
          <div className="c360-empty-prompt-icon">
            {isIndividual ? <User size={28} /> : <Building2 size={28} />}
          </div>
          <h3 className="c360-empty-prompt-title">No Customer Profile Selected</h3>
          <p className="c360-empty-prompt-desc">
            {isIndividual
              ? 'Select an ID type above (NRIC, Phone Number, Full Name, or Secondary ID) and enter the value to view the complete Customer 360 profile.'
              : 'Select a search type above (BRN, Old BRN, or Company Name) and enter the value to view the complete Customer 360 profile.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {isIndividual ? renderIndividualSearchPanel() : renderCorporateSearchPanel()}
        <div className={`error-container ${styles.spacer8}`}>
          <h3>Error Loading Profile</h3>
          <p>{getFriendlyErrorMessage({ message: error ?? undefined, status: errorStatus ?? undefined }, isIndividual ? 'individual-search' : 'corporate-search')}</p>
          <Button onClick={loadActiveProfile} className={styles.spacer9}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Not actually reachable: every branch above already returns unless `profile` is set (both halves
  // of the `loading`-false guard require `profile` truthy). This is here purely so TypeScript can
  // narrow `profile` past its `| null` type below — the OR'd conditions above are too complex for its
  // control-flow analysis to see through on their own.
  if (!profile) return null;

  // `profile` is CustomerProfile = IndividualProfile | CorporateProfile. This
  // component renders one shape or the other depending on `isIndividual`, so
  // narrow with two aliases (both referencing the exact same object at
  // runtime) rather than scattering individual casts — matches the pattern
  // already used in AllProducts.tsx / AllInteractions.tsx.
  const individualProfile = profile as IndividualProfile;
  const corporateProfile = profile as CorporateProfile;

  return (
    <div>
      {isIndividual ? renderIndividualSearchPanel() : renderCorporateSearchPanel()}

      {isIndividual ? (
        <div>
          <div className="customer-layout-container">

          {/* Left Column: Summary Card */}
          <div className={`customer-left-column ${styles.avatar}`}>
            {/* Purple circle avatar */}
            <div>
              {getInitials(individualProfile.fullName)}
            </div>

            {/* Name and Title */}
            <h3 className={styles.strong}>
              {individualProfile.fullName}
            </h3>
            <div className={styles.spacer10}>
              Job Title: {individualProfile.designation || '-'}
            </div>

            {/* Badges */}
            <span className={styles.strong2}>
              Customer Status: {individualProfile.flags || '-'}
            </span>

            {/* Divider line for visual layout */}
            <div className={styles.box5}></div>

            {/* Navigation buttons inside left card */}
            <div className={styles.stack}>
              {/* Customer Details Group */}
              <div>
                <button
                  className={`left-tab-btn ${styles.strong3}`}
                  onClick={() => setDetailsExpanded(!detailsExpanded)}
                >
                  <div className={styles.row4}>
                    <User size={16} />
                    <span>Customer Details</span>
                  </div>
                  {detailsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {detailsExpanded && (
                  <div className={styles.stack4}>
                    <button
                      className={`left-tab-btn ${activeTab === 'personal_details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('personal_details')}
                    >
                      <span>Personal Details</span>
                    </button>
                    <button
                      className={`left-tab-btn ${activeTab === 'residency_contact_details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('residency_contact_details')}
                    >
                      <span>Residency & Contact Details</span>
                    </button>
                    <button
                      className={`left-tab-btn ${activeTab === 'employment_details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('employment_details')}
                    >
                      <span>Employment Details</span>
                    </button>
                    <button
                      className={`left-tab-btn ${activeTab === 'additional_relationship_details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('additional_relationship_details')}
                    >
                      <span>Additional & Relationship Details</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Divider between sections */}
              <div className={styles.box6}></div>

              {/* Customer Workspace Group */}
              <div>
                <button
                  className={`left-tab-btn ${styles.strong3}`}
                  onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
                >
                  <div className={styles.row4}>
                    <Briefcase size={16} />
                    <span>Customer Workspace</span>
                  </div>
                  {workspaceExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {workspaceExpanded && (
                  <div className={styles.stack4}>
                    <button
                      className={`left-tab-btn ${activeTab === 'user_interactions' ? 'active' : ''}`}
                      onClick={() => setActiveTab('user_interactions')}
                    >
                      <span>User Interactions</span>
                    </button>
                    <button
                      className={`left-tab-btn ${activeTab === 'products' ? 'active' : ''}`}
                      onClick={() => setActiveTab('products')}
                    >
                      <span>Products</span>
                    </button>
                    <button
                      className={`left-tab-btn ${activeTab === 'rm_details' ? 'active' : ''}`}
                      onClick={() => setActiveTab('rm_details')}
                    >
                      <span>RM Details</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Content Workspace */}
          <div className="customer-right-column">

            {/* Tab switchers moved to left column */}

            {/* Active Content container */}
            <div
              className={['personal_details', 'residency_contact_details', 'employment_details', 'additional_relationship_details', 'overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab) ? "" : "data-table-container"}
              style={
                ['personal_details', 'residency_contact_details', 'employment_details', 'additional_relationship_details', 'overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab)
                  ? { padding: '8px 4px' }
                  : { padding: '16px 20px', backgroundColor: '#FFFFFF' }
              }
            >
              {/* DETAILS TABS & WORKSPACE DIRECT SECTIONS */}
              {['personal_details', 'residency_contact_details', 'employment_details', 'additional_relationship_details', 'personal', 'residency_details', 'residency', 'contact_details', 'contact', 'employment', 'additional_details', 'additional', 'details'].includes(activeTab) && (
                <IndividualDetails
                  subTab={activeTab}
                  profile={individualProfile}
                  contactInfo={contactInfo}
                  fieldConfigs={individualFieldConfigs}
                />
              )}

              {/* USER INTERACTIONS TAB */}
              {activeTab === 'user_interactions' && (
                <div>
                  {/* Search & filters */}
                  <div className={styles.spread}>
                    <div className={styles.rule3}>
                      <input
                        type="text"
                        placeholder="Search interactions..."
                        value={intSearchQuery}
                        onChange={(e) => {
                          setIntSearchQuery(e.target.value);
                          setIntPageNumber(1);
                        }}
                        className={styles.panel2}
                      />
                    </div>
                    <div className={styles.row5}>
                      <button
                        className={`btn ${styles.filterToggle}${intShowFilter ? ` ${styles.filterToggleOn}` : ''}`}

                        onClick={() => setIntShowFilter(!intShowFilter)}
                      >
                        <SlidersHorizontal size={13} className={styles.rule4} />
                        Filter
                      </button>
                      <div className={styles.row6}>
                        Show
                        <select
                          value={intShowMode}
                          onChange={(e) => {
                            setIntShowMode(e.target.value);
                            setIntPageNumber(1);
                          }}
                          className={styles.panel3}
                        >
                          <option value="5">5</option>
                          <option value="10">10</option>
                          <option value="custom">Custom</option>
                          <option value="all">All</option>
                        </select>
                        {intShowMode === 'custom' && (
                          <input
                            type="number"
                            min="1"
                            value={intCustomSize}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val) && val > 0) {
                                setIntCustomSize(val);
                                setIntPageNumber(1);
                              } else {
                                setIntCustomSize(e.target.value);
                              }
                            }}
                            className={styles.panel4}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {intShowFilter && (
                    <div className={styles.panel5}>
                      <div className={styles.stack5}>
                        <label className={styles.text}>Status</label>
                        <select
                          value={intStatusFilter}
                          onChange={(e) => {
                            setIntStatusFilter(e.target.value);
                            setIntPageNumber(1);
                          }}
                          className={styles.panel6}
                        >
                          <option value="">All Statuses</option>
                          {intData.uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <button
                        className={`btn ${styles.row7}`}
                        onClick={() => { setIntStatusFilter(''); setIntPageNumber(1); }}
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  {interactionsError ? (
                    <div className="error-container">
                      <p>{getFriendlyErrorMessage({ message: interactionsError ?? undefined, status: interactionsErrorStatus ?? undefined })}</p>
                      <Button onClick={() => loadInteractions(individualProfile.nationalId as string)} className={styles.spacer9}>
                        Retry
                      </Button>
                    </div>
                  ) : !loadingInteractions && intData.filtered.length === 0 ? (
                    <div className="empty-state">No interactions found.</div>
                  ) : (
                    <DataTable bare>
                      <ResponsiveRows
                        rows={paginatedInteractions}
                        loading={loadingInteractions}
                        loadingRows={5}
                        rowKey={(item) => String(item.caseId)}
                        columns={[
                          {
                            key: 'caseId',
                            label: 'Case ID',
                            priority: 'always',
                            render: (item) => (
                              <span className="account-num-text">{formatValue(item.caseId)}</span>
                            ),
                          },
                          {
                            key: 'category',
                            label: 'Category',
                            priority: 'high',
                            render: (item) => formatValue(item.category),
                          },
                          {
                            key: 'status',
                            label: 'Status',
                            priority: 'always',
                            render: (item) => (
                              <StatusBadge
                                status={formatValue(
                                  getLegacyInteractionField(item, 'status') || item.statusParent
                                )}
                              />
                            ),
                          },
                          {
                            key: 'source',
                            label: 'Source',
                            priority: 'low',
                            render: (item) =>
                              formatValue(getLegacyInteractionField(item, 'source') || item.sourceName),
                          },
                          {
                            key: 'classification',
                            label: 'Classification',
                            priority: 'low',
                            render: (item) => formatValue(item.classification || item.subCategory1),
                          },
                          {
                            key: 'complaintDate',
                            label: 'Complaint Date',
                            priority: 'low',
                            render: (item) =>
                              formatValue(
                                (item.dateComplaint || item.dateCase || '').split(' ')[0] ||
                                  item.positionDate
                              ),
                          },
                          {
                            key: 'action',
                            label: 'Action',
                            priority: 'always',
                            align: 'right',
                            render: (item) => (
                              <span
                                className={`action-link ${styles.row8}`}
                                onClick={() => openCaseModal(item)}
                              >
                                <Eye size={13} />
                                View
                              </span>
                            ),
                          },
                        ]}
                      />
                    </DataTable>
                  )}

                  {/* Pagination */}
                  {intTotalPages > 1 && (
                    <div className={styles.row9}>
                      <button
                        className={`btn ${styles.avatar2}`}
                        disabled={safeIntPageNumber === 1}
                        onClick={() => setIntPageNumber(safeIntPageNumber - 1)}
                      >
                        &lt;
                      </button>
                      {Array.from({ length: intTotalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          className={`btn ${styles.pageDot}${safeIntPageNumber === p ? ` ${styles.pageDotActive}` : ''}`}

                          onClick={() => setIntPageNumber(p)}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        className={`btn ${styles.avatar2}`}
                        disabled={safeIntPageNumber === intTotalPages}
                        onClick={() => setIntPageNumber(safeIntPageNumber + 1)}
                      >
                        &gt;
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* PRODUCTS TAB */}
              {activeTab === 'products' && (
                <div>
                  {/* Tabbed layout for Products Held / Interested Products */}
                  <div className={styles.row10}>
                    <span
                      className={`${styles.subTab}${productsTab === 'held' ? ` ${styles.subTabActive}` : ''}`}
                      onClick={() => setProductsTab('held')}
                    >
                      Product Held
                    </span>
                    <span
                      className={`${styles.subTab}${productsTab === 'interested' ? ` ${styles.subTabActive}` : ''}`}
                      onClick={() => setProductsTab('interested')}
                    >
                      Interested Products
                    </span>
                  </div>

                  {productsTab === 'held' && (
                    <div>
                      {/* Search & filters */}
                      <div className={styles.spread}>
                        <div className={styles.rule3}>
                          <input
                            type="text"
                            placeholder="Search products..."
                            value={indSearchQuery}
                            onChange={(e) => setIndSearchQuery(e.target.value)}
                            className={styles.panel2}
                          />
                        </div>
                        <div className={styles.row5}>
                          <button
                            className={`btn ${styles.filterToggle}${indShowFilter ? ` ${styles.filterToggleOn}` : ''}`}

                            onClick={() => setIndShowFilter(!indShowFilter)}
                          >
                            <SlidersHorizontal size={13} className={styles.rule4} />
                            Filter
                          </button>
                          <div className={styles.row6}>
                            Show
                            <select
                              value={indShowMode}
                              onChange={(e) => {
                                const mode = e.target.value;
                                setIndShowMode(mode);
                                const customerId = individualProfile.nationalId as string;
                                if (mode === '5') {
                                  loadProducts(customerId, 1, 5);
                                } else if (mode === '10') {
                                  loadProducts(customerId, 1, 10);
                                } else if (mode === 'custom') {
                                  const size = parseInt(String(indCustomSize), 10);
                                  const finalSize = (!isNaN(size) && size > 0) ? size : 5;
                                  loadProducts(customerId, 1, finalSize);
                                } else if (mode === 'all') {
                                  const targetSize = totalCount > 0 ? totalCount : 1000;
                                  loadProducts(customerId, 1, targetSize);
                                }
                              }}
                              className={styles.panel3}
                            >
                              <option value="5">5</option>
                              <option value="10">10</option>
                              <option value="custom">Custom</option>
                              <option value="all">All</option>
                            </select>
                            {indShowMode === 'custom' && (
                              <input
                                type="number"
                                min="1"
                                value={indCustomSize}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val) && val > 0) {
                                    setIndCustomSize(val);
                                    const customerId = individualProfile.nationalId as string;
                                    loadProducts(customerId, 1, val);
                                  } else {
                                    setIndCustomSize(e.target.value);
                                  }
                                }}
                                className={styles.panel4}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {indShowFilter && (
                        <div className={styles.panel5}>
                          <div className={styles.stack5}>
                            <label className={styles.text}>Product Type</label>
                            <select
                              value={indTypeFilter}
                              onChange={(e) => setIndTypeFilter(e.target.value)}
                              className={styles.panel6}
                            >
                              <option value="">All Types</option>
                              {indData.uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>

                          <div className={styles.stack5}>
                            <label className={styles.text}>Status</label>
                            <select
                              value={indStatusFilter}
                              onChange={(e) => setIndStatusFilter(e.target.value)}
                              className={styles.panel6}
                            >
                              <option value="">All Statuses</option>
                              {indData.uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>

                          <button
                            className={`btn ${styles.row7}`}
                            onClick={() => { setIndTypeFilter(''); setIndStatusFilter(''); }}
                          >
                            Clear
                          </button>
                        </div>
                      )}

                      {productsError ? (
                        <div className="error-container">
                          <p>{getFriendlyErrorMessage({ message: productsError ?? undefined, status: productsErrorStatus ?? undefined })}</p>
                          <Button onClick={() => loadProducts(individualProfile.nationalId as string, pageNumber, pageSize)} className={styles.spacer9}>
                            Retry
                          </Button>
                        </div>
                      ) : !loadingProducts && indData.filtered.length === 0 ? (
                        <div className="empty-state">No products found.</div>
                      ) : (
                        <DataTable bare>
                          <ResponsiveRows
                            rows={indData.filtered}
                            loading={loadingProducts}
                            loadingRows={5}
                            rowKey={(item) =>
                              String(item.accountNumber || getLegacyProductField(item, 'accountNo'))
                            }
                            columns={[
                              {
                                key: 'productName',
                                label: 'Product Name',
                                priority: 'always',
                                render: (item) => (
                                  <span className={styles.strong4}>{formatValue(item.productName)}</span>
                                ),
                              },
                              {
                                key: 'type',
                                label: 'Type',
                                priority: 'low',
                                render: (item) => formatValue(item.type || item.productCategory),
                              },
                              {
                                key: 'accountNumber',
                                label: 'Account Number',
                                priority: 'high',
                                render: (item) => (
                                  <span className="account-num-text">
                                    {formatValue(item.accountNumber || getLegacyProductField(item, 'accountNo'))}
                                  </span>
                                ),
                              },
                              {
                                key: 'tenure',
                                label: 'Tenure',
                                priority: 'low',
                                render: (item) => formatValue(item.tenure),
                              },
                              {
                                key: 'accountStatus',
                                label: 'Account Status',
                                priority: 'always',
                                render: (item) => (
                                  <StatusBadge
                                    status={formatValue(item.derivedAccountStatus || item.financingStatus)}
                                  />
                                ),
                              },
                              {
                                key: 'balance',
                                label: 'Balance',
                                priority: 'high',
                                render: (item) =>
                                  formatCurrency(
                                    item.balances || getLegacyProductField(item, 'placementAmount')
                                  ),
                              },
                              {
                                key: 'outstanding',
                                label: 'Outstanding',
                                priority: 'low',
                                render: (item) => formatCurrency(item.outstanding),
                              },
                              {
                                key: 'maturityDate',
                                label: 'Maturity Date',
                                priority: 'low',
                                render: (item) => formatValue(item.maturityDate),
                              },
                              {
                                key: 'timeline',
                                clamp: true,
                                label: 'Timeline & Summary',
                                priority: 'low',
                                render: (item) =>
                                  formatValue(
                                    getLegacyProductField(item, 'timelineSummary') ||
                                      getLegacyProductField(item, 'timelineAndSummary')
                                  ),
                              },
                              {
                                key: 'campaignCode',
                                label: 'Campaign Code',
                                priority: 'low',
                                render: (item) => formatValue(item.campaignCode),
                              },
                              {
                                key: 'action',
                                label: 'Action',
                                priority: 'always',
                                align: 'right',
                                render: (item) => (
                                  <span
                                    className={`action-link ${styles.row8}`}
                                    onClick={() =>
                                      openProductModal(
                                        (item.accountNumber ||
                                          getLegacyProductField(item, 'accountNo')) as string,
                                        (item.type || item.productCategory) as string
                                      )
                                    }
                                  >
                                    <Eye size={13} />
                                    View
                                  </span>
                                ),
                              },
                            ]}
                          />
                        </DataTable>
                      )}

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className={styles.row9}>
                          <button
                            className={`btn ${styles.avatar2}`}
                            disabled={pageNumber === 1 || loadingProducts}
                            onClick={() => loadProducts(individualProfile.nationalId as string, pageNumber - 1)}
                          >
                            &lt;
                          </button>
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                            <button
                              key={p}
                              className={`btn ${styles.pageDot}${pageNumber === p ? ` ${styles.pageDotActive}` : ''}`}
                              disabled={loadingProducts}
                              onClick={() => loadProducts(individualProfile.nationalId as string, p)}
                            >
                              {p}
                            </button>
                          ))}
                          <button
                            className={`btn ${styles.avatar2}`}
                            disabled={pageNumber === totalPages || loadingProducts}
                            onClick={() => loadProducts(individualProfile.nationalId as string, pageNumber + 1)}
                          >
                            &gt;
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {productsTab === 'interested' && (
                    <DataTable bare>
                      <ResponsiveRows
                        rows={
                          profile.interestedProductName || profile.interestedProductCategory
                            ? [profile]
                            : []
                        }
                        rowKey={() => 'interested-product'}
                        empty="No interested products found."
                        columns={[
                          {
                            key: 'name',
                            label: 'Product Name',
                            priority: 'always',
                            render: (row) => (
                              <span className={styles.strong4}>
                                {formatValue(row.interestedProductName)}
                              </span>
                            ),
                          },
                          {
                            key: 'category',
                            label: 'Product Category',
                            priority: 'always',
                            render: (row) => formatValue(row.interestedProductCategory),
                          },
                          {
                            key: 'engagement',
                            label: 'Engagement Count',
                            priority: 'low',
                            render: (row) => formatValue(row.engagementCount),
                          },
                          {
                            key: 'eligibility',
                            label: 'Eligibility Score',
                            priority: 'low',
                            render: (row) => formatValue(row.eligibilityScore),
                          },
                        ]}
                      />
                    </DataTable>
                  )}
                </div>
              )}

              {/* RM DETAILS TAB */}
              {activeTab === 'rm_details' && (
                <DataTable bare>
                  <ResponsiveRows
                    rows={profile.rmName || profile.rmId ? [profile] : []}
                    rowKey={() => 'relationship-manager'}
                    empty="No Relationship Manager details found."
                    columns={[
                      {
                        key: 'rmName',
                        label: 'Relationship Manager',
                        priority: 'always',
                        render: (row) => (
                          <span className={styles.strong4}>{formatValue(row.rmName)}</span>
                        ),
                      },
                      {
                        key: 'rmId',
                        label: 'Manager ID',
                        priority: 'high',
                        render: (row) => (
                          <span className="account-num-text">{formatValue(row.rmId)}</span>
                        ),
                      },
                      {
                        key: 'rmBranchCode',
                        label: 'Branch Code',
                        priority: 'low',
                        render: (row) => formatValue(row.rmBranchCode),
                      },
                      {
                        key: 'rmContactNo',
                        label: 'Manager Contact',
                        priority: 'low',
                        render: (row) => formatValue(row.rmContactNo),
                      },
                    ]}
                  />
                </DataTable>
              )}
            </div>
          </div>
        </div>
        </div>
      ) : (
        <div>
          <div className="customer-layout-container">
          {/* Left Column: Summary Card */}
          <div className={`customer-left-column ${styles.avatar}`}>
            {/* Blue circle avatar for company */}
            <div>
               {getInitials(corporateProfile.organizationName)}
             </div>

            {/* Company Name */}
            <h3 className={styles.strong}>
              {corporateProfile.organizationName}
            </h3>
            <div className={styles.spacer10}>
              BRN: {corporateProfile.brn || '-'}
            </div>

            {/* Badges */}
            <span className={styles.strong2}>
              Customer Status: {corporateProfile.lifecycleTrig || '-'}
            </span>

            {/* Divider line for visual layout */}
            <div className={styles.box5}></div>

            {/* Navigation buttons inside left card */}
            <div className={styles.stack3}>
              <button
                className={`left-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                <Building2 size={16} />
                <span>Company Overview</span>
              </button>

              <button
                className={`left-tab-btn ${activeTab === 'company_info' ? 'active' : ''}`}
                onClick={() => setActiveTab('company_info')}
              >
                <Briefcase size={16} />
                <span>Company Information</span>
              </button>

              <button
                className={`left-tab-btn ${activeTab === 'contact_relationship' ? 'active' : ''}`}
                onClick={() => setActiveTab('contact_relationship')}
              >
                <Phone size={16} />
                <span>Contact & Relationship</span>
              </button>

              <button
                className={`left-tab-btn ${activeTab === 'rmManager' ? 'active' : ''}`}
                onClick={() => setActiveTab('rmManager')}
              >
                <User size={16} />
                <span>RM Manager Information</span>
              </button>

              <button
                className={`left-tab-btn ${activeTab === 'products_signatories' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('products_signatories');
                  setCorpSubTab('products');
                }}
              >
                <Layers size={16} />
                <span>Products & Signatories</span>
              </button>

              <button
                className={`left-tab-btn ${activeTab === 'interestedProducts' ? 'active' : ''}`}
                onClick={() => setActiveTab('interestedProducts')}
              >
                <TrendingUp size={16} />
                <span>Interested Products</span>
              </button>
            </div>
          </div>

          {/* Right Column: Content Workspace */}
          <div className="customer-right-column">

            <div
              className={['overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab) ? "" : "data-table-container"}
              style={
                ['overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab)
                  ? { padding: '8px 4px' }
                  : { padding: '16px 20px', backgroundColor: '#FFFFFF' }
              }
            >
              {/* NON-INDIVIDUAL DETAIL TABS — config-driven, same as IndividualDetails.tsx. Which
                  Sections render under which of these four tabs is a fixed navigational grouping
                  (mirroring the tab structure this page already had); the fields/labels/order/
                  visibility/masking within each Section come entirely from corporateFieldConfigs. */}
              {(() => {
                const CORP_SUBTAB_SECTIONS: Record<string, string[]> = {
                  overview: ['Company Details', 'Online Banking Status', 'Business Registration'],
                  company_overview: ['Company Details', 'Online Banking Status', 'Business Registration'],
                  company_info: ['Company Information'],
                  company: ['Company Information'],
                  contact_relationship: ['Contact Information', 'Referrer & Relationship Information'],
                  contact: ['Contact Information', 'Referrer & Relationship Information'],
                  rmManager: ['RM Manager Information'],
                  rm_manager: ['RM Manager Information'],
                  rm: ['RM Manager Information'],
                };
                const sectionsForTab = CORP_SUBTAB_SECTIONS[activeTab];
                if (!sectionsForTab) return null;

                const effectiveCorpConfigs = corporateFieldConfigs && corporateFieldConfigs.length > 0
                  ? corporateFieldConfigs
                  : DEFAULT_CORPORATE_FIELD_CONFIGS;

                const configsForTab = effectiveCorpConfigs
                  .filter((f) => sectionsForTab.includes(f.section))
                  .sort((a, b) => a.displayOrder - b.displayOrder);
                const grouped = groupBySection(configsForTab);

                return (
                  <div className={styles.stack6}>
                    {grouped.map(({ section, fields }) => (
                      <DynamicProfileSection
                        key={section}
                        section={section}
                        fields={fields}
                        profile={corporateProfile}
                        contactInfo={contactInfo}
                        revealed={corpFieldReveal.revealed}
                        onToggleReveal={corpFieldReveal.toggleReveal}
                      />
                    ))}
                  </div>
                );
              })()}

              {/* PRODUCTS & SIGNATORIES TAB */}
              {activeTab === 'products_signatories' && (
                <div>
                  {/* Subtab Navigation side-by-side at the top */}
                  <div className={styles.row10}>
                    <span
                      className={`${styles.subTab}${corpSubTab === 'products' ? ` ${styles.subTabActive}` : ''}`}
                      onClick={() => setCorpSubTab('products')}
                    >
                      Products Held
                    </span>
                    <span
                      className={`${styles.subTab}${corpSubTab === 'signatories' ? ` ${styles.subTabActive}` : ''}`}
                      onClick={() => setCorpSubTab('signatories')}
                    >
                      Signatories
                    </span>
                  </div>

                  {corpSubTab === 'products' ? (
                    <div>
                      {/* Search & filters */}
                      <div className={styles.spread}>
                        <div className={styles.rule3}>
                          <input
                            type="text"
                            placeholder="Search products..."
                            value={corpSearchQuery}
                            onChange={(e) => setCorpSearchQuery(e.target.value)}
                            className={styles.panel2}
                          />
                        </div>
                        <div className={styles.row5}>
                          <button
                            className={`btn ${styles.filterToggle}${corpShowFilter ? ` ${styles.filterToggleOn}` : ''}`}
                            onClick={() => setCorpShowFilter(!corpShowFilter)}
                          >
                            <SlidersHorizontal size={13} className={styles.rule4} />
                            Filter
                          </button>
                          <div className={styles.row6}>
                            Show
                            <select
                              value={corpShowMode}
                              onChange={(e) => {
                                const mode = e.target.value;
                                setCorpShowMode(mode);
                                const customerId = corporateProfile.brn as string;
                                if (mode === '5') {
                                  loadProducts(customerId, 1, 5);
                                } else if (mode === '10') {
                                  loadProducts(customerId, 1, 10);
                                } else if (mode === 'custom') {
                                  const size = parseInt(String(corpCustomSize), 10);
                                  const finalSize = (!isNaN(size) && size > 0) ? size : 5;
                                  loadProducts(customerId, 1, finalSize);
                                } else if (mode === 'all') {
                                  const targetSize = totalCount > 0 ? totalCount : 1000;
                                  loadProducts(customerId, 1, targetSize);
                                }
                              }}
                              className={styles.panel3}
                            >
                              <option value="5">5</option>
                              <option value="10">10</option>
                              <option value="custom">Custom</option>
                              <option value="all">All</option>
                            </select>
                            {corpShowMode === 'custom' && (
                              <input
                                type="number"
                                min="1"
                                value={corpCustomSize}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val) && val > 0) {
                                    setCorpCustomSize(val);
                                    const customerId = corporateProfile.brn as string;
                                    loadProducts(customerId, 1, val);
                                  } else {
                                    setCorpCustomSize(e.target.value);
                                  }
                                }}
                                className={styles.panel4}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {corpShowFilter && (
                        <div className={styles.panel5}>
                          <div className={styles.stack5}>
                            <label className={styles.text}>Product Type</label>
                            <select
                              value={corpTypeFilter}
                              onChange={(e) => setCorpTypeFilter(e.target.value)}
                              className={styles.panel6}
                            >
                              <option value="">All Types</option>
                              {corpData.uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>

                          <div className={styles.stack5}>
                            <label className={styles.text}>Status</label>
                            <select
                              value={corpStatusFilter}
                              onChange={(e) => setCorpStatusFilter(e.target.value)}
                              className={styles.panel6}
                            >
                              <option value="">All Statuses</option>
                              {corpData.uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>

                          <button
                            className={`btn ${styles.row7}`}
                            onClick={() => { setCorpTypeFilter(''); setCorpStatusFilter(''); }}
                          >
                            Clear
                          </button>
                        </div>
                      )}

                      {productsError ? (
                        <div className="error-container">
                          <p>{getFriendlyErrorMessage({ message: productsError ?? undefined, status: productsErrorStatus ?? undefined })}</p>
                          <Button onClick={() => loadProducts(corporateProfile.brn as string, pageNumber, pageSize)} className={styles.spacer9}>
                            Retry
                          </Button>
                        </div>
                      ) : !loadingProducts && corpData.filtered.length === 0 ? (
                        <div className="empty-state">No products found.</div>
                      ) : (
                        <div>
                          <DataTable bare>
                            <ResponsiveRows
                              rows={corpData.filtered}
                              loading={loadingProducts}
                              loadingRows={5}
                              rowKey={(item) => String(item.accountNumber)}
                              columns={[
                                {
                                  key: 'category',
                                  label: 'Category',
                                  priority: 'always',
                                  render: (item) => (
                                    <span
                                      className={`${styles.typeChip}${item.type === 'Deposit' ? ` ${styles.typeChipDeposit}` : ''}`}
                                    >
                                      {item.type}
                                    </span>
                                  ),
                                },
                                {
                                  key: 'subCategory',
                                  label: 'Sub Category',
                                  priority: 'low',
                                  render: (item) => item.productCategory,
                                },
                                {
                                  key: 'productName',
                                  label: 'Product Name',
                                  priority: 'always',
                                  render: (item) => (
                                    <span className={styles.rule8}>{item.productName}</span>
                                  ),
                                },
                                {
                                  key: 'accountNumber',
                                  label: 'Account Number',
                                  priority: 'high',
                                  render: (item) => (
                                    <span className="account-num-text">{item.accountNumber}</span>
                                  ),
                                },
                                {
                                  key: 'accountStatus',
                                  label: 'Account Status',
                                  priority: 'always',
                                  render: (item) => (
                                    <StatusBadge
                                      status={item.derivedAccountStatus || item.financingStatus || EMPTY_VALUE}
                                    />
                                  ),
                                },
                                {
                                  key: 'balance',
                                  label: 'Balance',
                                  priority: 'high',
                                  render: (item) => item.balances || EMPTY_VALUE,
                                },
                                {
                                  key: 'outstanding',
                                  label: 'Outstanding',
                                  priority: 'low',
                                  render: (item) => item.outstanding || EMPTY_VALUE,
                                },
                                {
                                  key: 'lastContactDate',
                                  label: 'Last Contact Date',
                                  priority: 'low',
                                  render: (item) => item.lastContactDate || EMPTY_VALUE,
                                },
                                {
                                  key: 'action',
                                  label: 'Action',
                                  priority: 'always',
                                  align: 'right',
                                  render: (item) => (
                                    <span
                                      className={`action-link ${styles.row11}`}
                                      onClick={() => openProductModal(item.accountNumber, item.type as string)}
                                    >
                                      <Eye size={13} />
                                      View
                                    </span>
                                  ),
                                },
                              ]}
                            />
                          </DataTable>

                          {/* Pagination */}
                          {totalPages > 1 && (
                            <div className={styles.row9}>
                              <button
                                className={`btn ${styles.avatar2}`}
                                disabled={pageNumber === 1 || loadingProducts}
                                onClick={() => loadProducts(corporateProfile.brn as string, pageNumber - 1)}
                              >
                                &lt;
                              </button>
                              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                                <button
                                  key={p}
                                  className={`btn ${styles.pageDot}${pageNumber === p ? ` ${styles.pageDotActive}` : ''}`}
                                  disabled={loadingProducts}
                                  onClick={() => loadProducts(corporateProfile.brn as string, p)}
                                >
                                  {p}
                                </button>
                              ))}
                              <button
                                className={`btn ${styles.avatar2}`}
                                disabled={pageNumber === totalPages || loadingProducts}
                                onClick={() => loadProducts(corporateProfile.brn as string, pageNumber + 1)}
                              >
                                &gt;
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <h4 className="info-section-title">
                        <FileText size={16} />
                        Authorized Signatories
                      </h4>
                      <DataTable bare>
                        <ResponsiveRows
                          rows={[corporateProfile]}
                          rowKey={() => 'signatory'}
                          columns={[
                            {
                              key: 'name',
                              label: 'Signatory Name',
                              priority: 'always',
                              render: (row) => (
                                <span className={styles.rule8}>
                                  {row.signatoryName || EMPTY_VALUE}
                                </span>
                              ),
                            },
                            {
                              key: 'dob',
                              label: 'Date of Birth',
                              priority: 'low',
                              render: (row) => row.signatoryDateOfBirth || EMPTY_VALUE,
                            },
                            {
                              key: 'id',
                              label: 'ID Number',
                              priority: 'always',
                              render: (row) => (
                                <div className={styles.spread2}>
                                  <span>
                                    {revealed['sigId']
                                      ? row.signatoryIdNumber || EMPTY_VALUE
                                      : maskNRIC(row.signatoryIdNumber)}
                                  </span>
                                  {row.signatoryIdNumber &&
                                    row.signatoryIdNumber.trim() !== '' &&
                                    row.signatoryIdNumber.toLowerCase() !== 'null' && (
                                      <button
                                        onClick={() =>
                                          handleToggleReveal(
                                            'sigId',
                                            'Signatory ID Number',
                                            row.signatoryIdNumber!
                                          )
                                        }
                                        className={styles.row12}
                                        title={revealed['sigId'] ? 'Hide details' : 'Reveal details'}
                                      >
                                        {revealed['sigId'] ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                    )}
                                </div>
                              ),
                            },
                            {
                              key: 'phone',
                              label: 'Phone Number',
                              priority: 'high',
                              render: (row) => (
                                <div className={styles.spread2}>
                                  <span>
                                    {revealed['sigPhone']
                                      ? row.signatoryPhoneNumber || EMPTY_VALUE
                                      : maskPhone(row.signatoryPhoneNumber)}
                                  </span>
                                  {row.signatoryPhoneNumber &&
                                    row.signatoryPhoneNumber.trim() !== '' &&
                                    row.signatoryPhoneNumber.toLowerCase() !== 'null' && (
                                      <button
                                        onClick={() =>
                                          handleToggleReveal(
                                            'sigPhone',
                                            'Signatory Phone Number',
                                            row.signatoryPhoneNumber!
                                          )
                                        }
                                        className={styles.row12}
                                        title={revealed['sigPhone'] ? 'Hide details' : 'Reveal details'}
                                      >
                                        {revealed['sigPhone'] ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                    )}
                                </div>
                              ),
                            },
                            {
                              key: 'position',
                              label: 'Position',
                              priority: 'low',
                              render: (row) => row.signatoryPosition || EMPTY_VALUE,
                            },
                          ]}
                        />
                      </DataTable>
                    </div>
                  )}
                </div>
              )}

              {/* INTERESTED PRODUCTS */}
              {activeTab === 'interestedProducts' && (
                <div>
                  <h4 className={`info-section-title ${styles.label}`}>
                    <TrendingUp size={14} />
                    Interested Products
                  </h4>
                  <DataTable bare>
                    <ResponsiveRows
                      rows={[profile]}
                      rowKey={() => 'interested-product-corporate'}
                      columns={[
                        {
                          key: 'name',
                          label: 'Product Name',
                          priority: 'always',
                          render: (row) => (
                            <span className={styles.rule8}>
                              {formatValue(row.interestedProductName || row.interestedProduct)}
                            </span>
                          ),
                        },
                        {
                          key: 'category',
                          label: 'Product Category',
                          priority: 'always',
                          render: (row) => formatValue(row.interestedProductCategory),
                        },
                        {
                          key: 'engagement',
                          label: 'Engagement Count',
                          priority: 'low',
                          render: (row) => formatValue(row.engagementCount),
                        },
                        {
                          key: 'eligibility',
                          label: 'Eligibility Score',
                          priority: 'low',
                          render: (row) => formatValue(row.eligibilityScore),
                        },
                      ]}
                    />
                  </DataTable>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      )}


      {/* Modals */}
      <CaseDetailsModal />
      <ProductDetailsModal />
    </div>
  );
}
