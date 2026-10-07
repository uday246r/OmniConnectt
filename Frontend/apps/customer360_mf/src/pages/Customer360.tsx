import { canSeeProfilePanel } from '../api/hostBridge';
import React, { useEffect, useState, useRef } from 'react';
import { useCustomerStore, readSavedCustomer, clearSavedCustomer } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useProductStore } from '../store/productStore';
import { api, ApiError } from '../services/api';
import { getFriendlyErrorMessage, idTypeToFriendlyLabel } from '../utils/errorMessages';
import { maskPhone, maskNRIC, maskTIN } from '../utils/masking';
import CustomerHeader from '../components/CustomerHeader';
import IndividualDetails from '../components/IndividualDetails';
import CaseDetailsModal from '../components/CaseDetailsModal';
import ProductDetailsModal from '../components/ProductDetailsModal';
import DynamicProfileSection, { groupBySection } from '../components/DynamicProfileSection';
import { useFieldReveal } from '../hooks/useFieldReveal';
import { useRecentLookups } from '../hooks/useRecentLookups';
import { Eye, EyeOff, ChevronRight, ChevronDown, SlidersHorizontal, Building2, Layers, User, Briefcase, Globe, Shield, FileText, Calendar, DollarSign, MapPin, Mail, Phone, TrendingUp, Search, RotateCcw, RefreshCw, AlertCircle, Loader2 } from '@omniconnect/ui/icons';
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
import cc from '../shared/c360Common.module.css';
import { Button, ColumnFilter, DataTable, EMPTY_VALUE, FilterBar, Input, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, Select, getInitials, sanitizeFilterInput, useDebouncedValue, type ActiveFilter, type FilterInputType } from '@omniconnect/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney, resolveProductStatus } from '../shared/formatValue';
import { formatCustomerName, cleanSegmentValue } from '../utils/customerProfileFormatters';
import { useShallow } from 'zustand/react/shallow';


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
  const { customerType, profile, contactInfo, loading, error, errorStatus, loadActiveProfile } = useCustomerStore(useShallow((s) => ({ customerType: s.customerType, profile: s.profile, contactInfo: s.contactInfo, loading: s.loading, error: s.error, errorStatus: s.errorStatus, loadActiveProfile: s.loadActiveProfile })));
  const {
    interactions,
    loading: loadingInteractions,
    error: interactionsError,
    errorStatus: interactionsErrorStatus,
    loadInteractions,
    openCaseModal
  } = useInteractionStore(useShallow((s) => ({ interactions: s.interactions, loading: s.loading, error: s.error, errorStatus: s.errorStatus, loadInteractions: s.loadInteractions, openCaseModal: s.openCaseModal })));
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
  } = useProductStore(useShallow((s) => ({ products: s.products, loading: s.loading, error: s.error, errorStatus: s.errorStatus, loadProducts: s.loadProducts, openProductModal: s.openProductModal, pageNumber: s.pageNumber, pageSize: s.pageSize, totalCount: s.totalCount, totalPages: s.totalPages, setPageNumber: s.setPageNumber, setPageSize: s.setPageSize })));

  const navigate = useHostNavigate();

  // Adjust tabs based on customerType
  const isIndividual = customerType === 'individual';

  // Tab states
  const [activeTab, setActiveTab] = useState('personal_details'); // 'personal_details' for Individual; 'overview' for Corporate

  /*
   * Which panels of the 360 view this user was granted.
   *
   * The keys match Customer360CapabilityManifest exactly, which is what an administrator sees in the
   * Role editor and what the endpoints behind these panels enforce — a panel hidden here also
   * answers 403 if requested directly, so this is presentation, not the control.
   */
  const canSeeContactsPanel = canSeeProfilePanel('panel.contacts');
  const canSeeInteractionsPanel = canSeeProfilePanel('panel.interactions');
  const canSeeProductsPanel = canSeeProfilePanel('panel.products');
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

  /*
   * Recommendations for the two identity lookups.
   *
   * These panels fetch one profile from one identity number, so there is no loaded table to draw
   * candidates from, and firing a server search on a half-typed NRIC would be both noisy and
   * meaningless — the lookups stay Enter-to-submit. What can be offered for free is the operator's
   * own successful lookups, which is also the common case: coming back to a customer they checked
   * earlier. See useRecentLookups.
   */
  const individualRecents = useRecentLookups('c360.recentLookups.individual');
  const corporateRecents = useRecentLookups('c360.recentLookups.corporate');

  const matchRecents = (
    entries: { value: string; idType: string; label: string }[],
    idType: string,
    typed: string,
  ) => {
    const scoped = entries.filter((e) => e.idType === idType);
    const q = typed.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((e) => e.value.toLowerCase().includes(q) || e.label.toLowerCase().includes(q));
  };

  const individualSuggestions = matchRecents(individualRecents.recents, searchIdType, searchVal);
  const corporateSuggestions = matchRecents(corporateRecents.recents, corpSearchType, corpSearchVal);

  // Individual Product Held states
  const [indSearchQuery, setIndSearchQuery] = useState('');
  const [indTypeFilter, setIndTypeFilter] = useState('');
  const [indStatusFilter, setIndStatusFilter] = useState('');

  // Corporate (Non-Individual) Product Held states
  const [corpSearchQuery, setCorpSearchQuery] = useState('');
  const [corpTypeFilter, setCorpTypeFilter] = useState('');
  const [corpStatusFilter, setCorpStatusFilter] = useState('');

  // Corporate Subtab toggle for Products & Signatories
  const [corpSubTab, setCorpSubTab] = useState('products');

  // Interactions states
  const [intSearchQuery, setIntSearchQuery] = useState('');
  const [intStatusFilter, setIntStatusFilter] = useState('');
  const [intPageSize, setIntPageSize] = useState(5);
  const [intPageNumber, setIntPageNumber] = useState(1);

  // These three search boxes filter an already-loaded, in-memory list on every keystroke — with no
  // debounce that meant every character retyped the filtered array and re-rendered the whole table.
  // The boxes themselves stay bound to the raw value (typing must never feel laggy); only the
  // filtering below waits for the debounce.
  const debouncedIndSearchQuery = useDebouncedValue(indSearchQuery, 200);
  const debouncedCorpSearchQuery = useDebouncedValue(corpSearchQuery, 200);
  const debouncedIntSearchQuery = useDebouncedValue(intSearchQuery, 200);

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // Writes no audit entry — see useFieldReveal for why an unmask the server never sees is not an
  // auditable event, and what it would take to make it one.
  const handleToggleReveal = (fieldKey: string, _fieldLabel: string, realVal: string) => {
    if (!realVal || realVal.trim() === '' || realVal.toLowerCase() === 'null') return;
    setRevealed(prev => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
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
        // Only a lookup that actually resolved is remembered, so a typo never becomes a suggestion.
        individualRecents.remember({
          value: searchVal,
          idType: searchIdType,
          label: loadedProfile.fullName || searchVal,
        });

        /*
         * The lookup is audited by Customer360Service's ProfileController, which served it — this
         * used to fire a second, client-authored row for the same event. The server-side row is the
         * one that can be trusted (its actor comes from the verified token, and it is written whether
         * or not this code path chooses to report), and unlike this one it also exists when the
         * lookup finds nothing, which is the case an audit trail most needs.
         */
      }

    } catch (err) {
      const error = err as ApiError;
      const idLabel = idTypeToFriendlyLabel(searchIdType, searchSubtype);
      setSearchError(getFriendlyErrorMessage(error, 'individual-search', error?.status === 400 ? idLabel : ''));
      // The failed lookup is recorded server-side by the endpoint that refused it.
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
        corporateRecents.remember({
          value: corpSearchVal,
          idType: corpSearchType,
          label: loadedProfile.organizationName || corpSearchVal,
        });

        // Audited server-side by ProfileController — see the individual search above.
      }

    } catch (err) {
      const error = err as ApiError;
      const idLabel = idTypeToFriendlyLabel(corpSearchType);
      setCorpSearchError(getFriendlyErrorMessage(error, 'corporate-search', error?.status === 400 ? idLabel : ''));
      // The failed lookup is recorded server-side by the endpoint that refused it.
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
    // Skipped outright when the panel was not granted: the endpoint answers 403, and the store would
    // record that as a load failure the user then sees as an error on a panel they cannot open.
    if (profile && canSeeInteractionsPanel) {
      const customerId = isIndividual ? (profile as IndividualProfile).nationalId : (profile as CorporateProfile).brn;
      loadInteractions(customerId as string);
    }
  }, [profile, isIndividual]);

  // Load products based on profile and store pagination state
  const lastParamsRef = useRef<{ customerId: string | null | undefined; pageNumber: number | null; pageSize: number | null }>({ customerId: null, pageNumber: null, pageSize: null });

  useEffect(() => {
    if (profile && canSeeProductsPanel) {
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
    setIndTypeFilter('');
    setIndStatusFilter('');

    setCorpSearchQuery('');
    setCorpTypeFilter('');
    setCorpStatusFilter('');

    setIntSearchQuery('');
    setIntStatusFilter('');
    setIntPageSize(5);
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
    const rawStatuses = products.map(p => resolveProductStatus(p)).filter(Boolean);
    const uniqueTypes = Array.from(new Set(rawTypes));
    const uniqueStatuses = Array.from(new Set(rawStatuses));

    // 2. Filter products
    const query = (isInd ? debouncedIndSearchQuery : debouncedCorpSearchQuery).toLowerCase().trim();
    const typeF = isInd ? indTypeFilter : corpTypeFilter;
    const statusF = isInd ? indStatusFilter : corpStatusFilter;

    const filtered = products.filter(item => {
      const matchesSearch = !query ||
        (item.productName || '').toLowerCase().includes(query) ||
        (item.accountNumber || getLegacyProductField(item, 'accountNo') || '').toLowerCase().includes(query) ||
        (item.type || item.productCategory || '').toLowerCase().includes(query);

      const matchesType = !typeF || (item.type || item.productCategory || '') === typeF;
      const matchesStatus = !statusF || resolveProductStatus(item) === statusF;

      return matchesSearch && matchesType && matchesStatus;
    });

    return { filtered, uniqueTypes, uniqueStatuses };
  };

  const indData = getFilteredAndUnique(true);
  const corpData = getFilteredAndUnique(false);

  // Recommends matching products as the operator types, rather than only narrowing the table
  // silently — the same "show it, don't make them press Enter" treatment the Name/Mobile column
  // filters on the Users page have. Picking one commits the product's own name as the search term.
  const productSuggestions = (isInd: boolean) => {
    const query = (isInd ? debouncedIndSearchQuery : debouncedCorpSearchQuery).toLowerCase().trim();
    if (!query) return [];
    return products
      .filter(
        (item) =>
          (item.productName || '').toLowerCase().includes(query) ||
          (item.accountNumber || getLegacyProductField(item, 'accountNo') || '').toLowerCase().includes(query) ||
          (item.type || item.productCategory || '').toLowerCase().includes(query),
      )
      .slice(0, 8)
      .map((item) => ({
        id: item.productName || (item.accountNumber ?? getLegacyProductField(item, 'accountNo')) || '',
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{formatValue(item.productName)}</span>
            <span className={styles.suggestionSecondary}>
              {item.type || item.productCategory} · {formatValue(item.accountNumber || getLegacyProductField(item, 'accountNo'))}
            </span>
          </span>
        ),
      }));
  };
  const indSearchSuggestions = productSuggestions(true);
  const corpSearchSuggestions = productSuggestions(false);

  const getFilteredInteractions = () => {
    const query = debouncedIntSearchQuery.toLowerCase().trim();
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

  // Same recommend-as-you-type treatment for the interactions search.
  const intSearchSuggestions = (() => {
    const query = debouncedIntSearchQuery.toLowerCase().trim();
    if (!query) return [];
    return interactions
      .filter(
        (item) =>
          (item.caseId || '').toLowerCase().includes(query) ||
          (item.category || '').toLowerCase().includes(query) ||
          (item.classification || item.subCategory1 || '').toLowerCase().includes(query),
      )
      .slice(0, 8)
      .map((item) => ({
        id: String(item.caseId ?? ''),
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{formatValue(item.caseId)}</span>
            <span className={styles.suggestionSecondary}>{formatValue(item.category)}</span>
          </span>
        ),
      }));
  })();

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
            <Select
              size="lg"
              value={searchIdType}
              onChange={(e) => {
                setSearchIdType(e.target.value);
                setSearchSubtype('');
                setSearchVal('');
                setSearchError('');
              }}
              placeholder="Select ID Type"
              options={dropdownOptions.idTypes}
            />
          </div>

          {/* Secondary ID Type Select */}
          {searchIdType === 'SecondaryID' ? (
            <div className="c360-form-group">
              <label className="c360-label">
                Document Type <span className="c360-required">*</span>
              </label>
              <Select
                size="lg"
                value={searchSubtype}
                onChange={(e) => {
                  setSearchSubtype(e.target.value);
                  setSearchVal('');
                  setSearchError('');
                }}
                placeholder="Select Document"
                options={dropdownOptions.secondaryIdTypes}
              />
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
            <Input
              className={searchIdType === 'SecondaryID' ? styles.searchSpanNarrow : styles.searchSpan}
              label={
                searchIdType === 'Phone' ? 'Phone Number' :
                searchIdType === 'Name' ? 'Full Name' :
                searchIdType === 'NRIC' ? 'National ID (NRIC)' :
                (dropdownOptions.secondaryIdTypes.find((opt) => opt.value === searchSubtype)?.label || 'Identity Number')
              }
              required
              leading={<Search size={16} />}
              type="text"
              placeholder={
                searchIdType === 'Phone' ? 'e.g. +60123456789 or 0123456789' :
                searchIdType === 'Name' ? 'e.g. Ahmad bin Razak' :
                searchIdType === 'NRIC' ? 'e.g. 900101-14-5566 or 900101145566' :
                searchSubtype === 'PASSPORT' ? 'e.g. A12345678' : 'Enter identity number'
              }
              value={searchVal}
              onChange={(e) => {
                // Restrict keystrokes to what the chosen ID type can actually hold — NRIC and
                // Phone are digits-only, Name is letters-only. Secondary ID formats vary by
                // subtype (passport numbers mix letters and digits), so it stays unrestricted.
                const filterType: FilterInputType =
                  searchIdType === 'Phone' || searchIdType === 'NRIC' ? 'numeric' :
                  searchIdType === 'Name' ? 'alpha' : 'text';
                setSearchVal(sanitizeFilterInput(e.target.value, filterType));
                setSearchError('');
              }}
              autoFocus
            />
          )}

          {searchIdType && individualSuggestions.length > 0 && (
            <div className={styles.recentWrap}>
              <span className={styles.recentLabel}>Recent lookups</span>
              <div className={styles.recentList}>
                {individualSuggestions.map((r) => (
                  <button
                    key={`${r.idType}:${r.value}`}
                    type="button"
                    className={styles.recentItem}
                    onClick={() => { setSearchVal(r.value); setSearchError(''); }}
                  >
                    <span className={styles.recentName}>{r.label}</span>
                    <span className={styles.recentValue}>{r.value}</span>
                  </button>
                ))}
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
            <Select
              size="lg"
              value={corpSearchType}
              onChange={(e) => {
                setCorpSearchType(e.target.value);
                setCorpSearchVal('');
                setCorpSearchError('');
              }}
              placeholder="Select Search Type"
              options={dropdownOptions.corpSearchTypes}
            />
          </div>

          {/* Search Input — only once a search type is actually chosen. Previously unconditional,
              which meant it fell through to the "Company / Organization Name" branch (the ternary's
              else case) even with nothing selected — indistinguishable from genuinely having chosen
              Company Name search. */}
          {corpSearchType && (
            <Input
              className={styles.rule2}
              label={
                corpSearchType === 'BRN' ? 'BRN (Business Registration Number)' :
                corpSearchType === 'OLDBRN' ? 'Old Registration Number' :
                'Company / Organization Name'
              }
              required
              leading={<Search size={16} />}
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
              autoFocus
            />
          )}

          {corpSearchType && corporateSuggestions.length > 0 && (
            <div className={styles.recentWrap}>
              <span className={styles.recentLabel}>Recent lookups</span>
              <div className={styles.recentList}>
                {corporateSuggestions.map((r) => (
                  <button
                    key={`${r.idType}:${r.value}`}
                    type="button"
                    className={styles.recentItem}
                    onClick={() => { setCorpSearchVal(r.value); setCorpSearchError(''); }}
                  >
                    <span className={styles.recentName}>{r.label}</span>
                    <span className={styles.recentValue}>{r.value}</span>
                  </button>
                ))}
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

          {/*
            Left Column: Summary Card.

            `styles.avatar` belongs on the initials bubble INSIDE this column, not on the column
            itself — it is an 80x80 circle, so applying it here collapsed the whole summary card to
            80px wide inside its 280px grid track and the name, job title and status badges spilled
            out of it. The profile did load; it was just unreadable.
          */}
          <div className="customer-left-column">
            {/* Purple circle avatar */}
            <div className={styles.avatar}>
              {getInitials(individualProfile.fullName)}
            </div>

            {/* Name and Title */}
            <h3 className={styles.strong}>
              {formatCustomerName(individualProfile.salutation, individualProfile.fullName)}
            </h3>
            <div className={styles.spacer10}>
              Job Title: {individualProfile.designation || '-'}
            </div>

            {/* Badges */}
            <div className={styles.badgeGroup}>
              <span className={styles.strong2}>
                Customer Status: {individualProfile.flags || '-'}
              </span>
              {cleanSegmentValue(individualProfile.segmentation) && (
                <span className={styles.segmentBadge}>
                  {cleanSegmentValue(individualProfile.segmentation)}
                </span>
              )}
            </div>

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
                    {canSeeInteractionsPanel && (
                      <button
                        className={`left-tab-btn ${activeTab === 'user_interactions' ? 'active' : ''}`}
                        onClick={() => setActiveTab('user_interactions')}
                      >
                        <span>User Interactions</span>
                      </button>
                    )}
                    {canSeeProductsPanel && (
                      <button
                        className={`left-tab-btn ${activeTab === 'products' ? 'active' : ''}`}
                        onClick={() => setActiveTab('products')}
                      >
                        <span>Products</span>
                      </button>
                    )}
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
              className={
                ['personal_details', 'residency_contact_details', 'employment_details', 'additional_relationship_details', 'overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab)
                  ? styles.contentPad
                  : styles.contentStack
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
                <div className={cc.card}>
                  {/* Controls Toolbar */}
                  <div className={cc.toolbar}>
                    <div className={cc.toolbarSearch}>
                      <SearchField
                        placeholder="Search interactions by case ID, category..."
                        value={intSearchQuery}
                        onValueChange={(val) => {
                          setIntSearchQuery(val);
                          setIntPageNumber(1);
                        }}
                        suggestions={intSearchSuggestions}
                        onSelectSuggestion={(s) => { setIntSearchQuery(s.id); setIntPageNumber(1); }}
                        emptyHint="No matching interactions."
                      />
                    </div>
                    <div className={cc.toolbarActions}>
                      <RowsPerPage
                        storageKey="c360.ind.interactions"
                        value={intPageSize}
                        onChange={(s) => {
                          setIntPageSize(s);
                          setIntPageNumber(1);
                        }}
                      />

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => individualProfile.nationalId && loadInteractions(individualProfile.nationalId as string, { fresh: true })}
                        disabled={loadingInteractions}
                        leadingIcon={<RefreshCw size={14} className={loadingInteractions ? 'animate-spin' : ''} />}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>

                  {/* Status is filtered via the column header below; this bar surfaces both active
                      filters as removable chips, matching the Users page and Audit Logs convention. */}
                  <FilterBar
                    filters={[
                      intSearchQuery && { key: 'search', label: 'Search', value: `"${intSearchQuery}"`, onRemove: () => setIntSearchQuery('') },
                      intStatusFilter && { key: 'status', label: 'Status', value: intStatusFilter, onRemove: () => setIntStatusFilter('') },
                    ].filter(Boolean) as ActiveFilter[]}
                    onClearAll={() => {
                      setIntSearchQuery('');
                      setIntStatusFilter('');
                      setIntPageNumber(1);
                    }}
                  />

                  {interactionsError ? (
                    <div className="error-container">
                      <p>{getFriendlyErrorMessage({ message: interactionsError ?? undefined, status: interactionsErrorStatus ?? undefined })}</p>
                      <Button onClick={() => loadInteractions(individualProfile.nationalId as string)} className={styles.spacer9}>
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <DataTable
                      bare
                      minWidth={750}
                      footer={
                        <Pagination
                          page={safeIntPageNumber}
                          pageSize={intPageSize}
                          total={intData.filtered.length}
                          itemLabel="case"
                          onPageChange={setIntPageNumber}
                        />
                      }
                    >
                      <ResponsiveRows
                        rows={paginatedInteractions}
                        loading={loadingInteractions}
                        loadingRows={intPageSize}
                        rowKey={(item) => String(item.caseId)}
                        empty={
                          intSearchQuery || intStatusFilter
                            ? 'No interactions match the selected filters. Try adjusting your search query or filters.'
                            : 'No customer interactions recorded yet.'
                        }
                        columns={[
                          {
                            key: 'caseId',
                            label: 'Case ID',
                            priority: 'always',
                            render: (item) => (
                              <span className={cc.monoValue}>{formatValue(item.caseId)}</span>
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
                            header: (
                              <ColumnFilter
                                label="Status"
                                value={intStatusFilter}
                                onChange={(v) => {
                                  setIntStatusFilter(v);
                                  setIntPageNumber(1);
                                }}
                                options={intData.uniqueStatuses.map((s) => ({ value: s, label: s }))}
                                allLabel="All Statuses"
                                searchable
                              />
                            ),
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
                              <RowAction onClick={() => openCaseModal(item)} />
                            ),
                          },
                        ]}
                      />
                    </DataTable>
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
                    <div className={cc.card}>
                      {/* Controls Toolbar */}
                      <div className={cc.toolbar}>
                        <div className={cc.toolbarSearch}>
                          <SearchField
                            placeholder="Search products by name, account number..."
                            value={indSearchQuery}
                            onValueChange={setIndSearchQuery}
                            suggestions={indSearchSuggestions}
                            onSelectSuggestion={(s) => setIndSearchQuery(s.id)}
                            emptyHint="No matching products."
                          />
                        </div>
                        <div className={cc.toolbarActions}>
                          <RowsPerPage
                            storageKey="c360.ind.products"
                            value={pageSize}
                            onChange={(s) => {
                              setPageSize(s);
                              const customerId = individualProfile.nationalId as string;
                              loadProducts(customerId, 1, s);
                            }}
                          />

                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => individualProfile.nationalId && loadProducts(individualProfile.nationalId as string, pageNumber, pageSize)}
                            disabled={loadingProducts}
                            leadingIcon={<RefreshCw size={14} className={loadingProducts ? 'animate-spin' : ''} />}
                          >
                            Refresh
                          </Button>
                        </div>
                      </div>

                      {/* Type and Status are filtered via their own column headers below; this bar
                          surfaces every active filter as a removable chip. */}
                      <FilterBar
                        filters={[
                          indSearchQuery && { key: 'search', label: 'Search', value: `"${indSearchQuery}"`, onRemove: () => setIndSearchQuery('') },
                          indTypeFilter && { key: 'type', label: 'Type', value: indTypeFilter, onRemove: () => setIndTypeFilter('') },
                          indStatusFilter && { key: 'status', label: 'Status', value: indStatusFilter, onRemove: () => setIndStatusFilter('') },
                        ].filter(Boolean) as ActiveFilter[]}
                        onClearAll={() => {
                          setIndSearchQuery('');
                          setIndTypeFilter('');
                          setIndStatusFilter('');
                        }}
                      />

                      {productsError ? (
                        <div className="error-container">
                          <p>{getFriendlyErrorMessage({ message: productsError ?? undefined, status: productsErrorStatus ?? undefined })}</p>
                          <Button onClick={() => loadProducts(individualProfile.nationalId as string, pageNumber, pageSize)} className={styles.spacer9}>
                            Retry
                          </Button>
                        </div>
                      ) : (
                        <DataTable
                          bare
                          footer={
                            <Pagination
                              page={pageNumber}
                              pageSize={pageSize}
                              total={totalCount}
                              itemLabel="product"
                              onPageChange={(p) => loadProducts(individualProfile.nationalId as string, p, pageSize)}
                            />
                          }
                        >
                          <ResponsiveRows
                            rows={indData.filtered}
                            loading={loadingProducts}
                            loadingRows={pageSize}
                            rowKey={(item) =>
                              String(item.accountNumber || getLegacyProductField(item, 'accountNo'))
                            }
                            empty={
                              indSearchQuery || indTypeFilter || indStatusFilter
                                ? 'No products match the selected filters. Try adjusting your search query or filters.'
                                : 'No active banking products found for this customer.'
                            }
                            columns={[
                              {
                                key: 'productName',
                                label: 'Product Name',
                                priority: 'always',
                                render: (item) => (
                                  <div>
                                    <div className={styles.strong4}>
                                      {formatValue(item.productName)}
                                    </div>
                                    {item.campaignCode && (
                                      <div className={cc.monoMeta}>
                                        Campaign: {item.campaignCode}
                                      </div>
                                    )}
                                  </div>
                                ),
                              },
                              {
                                key: 'type',
                                label: 'Type',
                                priority: 'always',
                                header: (
                                  <ColumnFilter
                                    label="Type"
                                    value={indTypeFilter}
                                    onChange={setIndTypeFilter}
                                    options={indData.uniqueTypes.map((t) => ({ value: t, label: t }))}
                                    allLabel="All Types"
                                    searchable
                                  />
                                ),
                                render: (item) => (
                                  <span
                                    className={`${styles.typeChip}${item.type === 'Deposit' ? ` ${styles.typeChipDeposit}` : ''}`}
                                  >
                                    {formatValue(item.type || item.productCategory)}
                                  </span>
                                ),
                              },
                              {
                                key: 'accountNumber',
                                label: 'Account Number',
                                priority: 'high',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {formatValue(item.accountNumber || getLegacyProductField(item, 'accountNo'))}
                                  </span>
                                ),
                              },
                              {
                                key: 'accountStatus',
                                label: 'Status',
                                priority: 'always',
                                header: (
                                  <ColumnFilter
                                    label="Status"
                                    value={indStatusFilter}
                                    onChange={setIndStatusFilter}
                                    options={indData.uniqueStatuses.map((s) => ({ value: s, label: s }))}
                                    allLabel="All Statuses"
                                    searchable
                                  />
                                ),
                                render: (item) => (
                                  <StatusBadge
                                    status={resolveProductStatus(item)}
                                    dot={true}
                                  />
                                ),
                              },
                              {
                                key: 'balance',
                                label: 'Balance',
                                priority: 'high',
                                render: (item) => (
                                  <span className={cc.monoAccent}>
                                    {formatCurrency(
                                      item.balances || getLegacyProductField(item, 'placementAmount')
                                    )}
                                  </span>
                                ),
                              },
                              {
                                key: 'outstanding',
                                label: 'Outstanding',
                                priority: 'low',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {item.outstanding ? formatCurrency(item.outstanding) : EMPTY_VALUE}
                                  </span>
                                ),
                              },
                              {
                                key: 'tenureMaturity',
                                label: 'Tenure / Maturity',
                                priority: 'low',
                                render: (item) => (
                                  <div>
                                    {item.tenure ? <div className={cc.monoValue}>{item.tenure}</div> : null}
                                    {item.maturityDate ? (
                                      <div className={cc.monoMeta}>
                                        Matures: {item.maturityDate}
                                      </div>
                                    ) : null}
                                    {!item.tenure && !item.maturityDate && (
                                      <span className={cc.mutedText}>{EMPTY_VALUE}</span>
                                    )}
                                  </div>
                                ),
                              },
                              {
                                key: 'effectiveDate',
                                label: 'Opening Date',
                                priority: 'low',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {formatValue(
                                      item.accountOpeningDate ||
                                        item.commencementDate ||
                                        item.cardIssuanceDate ||
                                        item.disbursedDate ||
                                        item.createdDate ||
                                        item.lastContactDate
                                    )}
                                  </span>
                                ),
                              },
                              {
                                key: 'action',
                                label: 'Action',
                                priority: 'always',
                                align: 'right',
                                render: (item) => (
                                  <RowAction
                                    onClick={() =>
                                      openProductModal(
                                        (item.accountNumber ||
                                          getLegacyProductField(item, 'accountNo')) as string,
                                        (item.type || item.productCategory) as string
                                      )
                                    }
                                  />
                                ),
                              },
                            ]}
                          />
                        </DataTable>
                      )}
                    </div>
                  )}

                  {productsTab === 'interested' && (
                    <div className={cc.card}>
                      <DataTable bare minWidth={600}>
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
                    </div>
                  )}
                </div>
              )}

              {/* RM DETAILS TAB */}
              {activeTab === 'rm_details' && (
                <div className={cc.card}>
                  <DataTable bare minWidth={600}>
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
                            <span className={cc.monoValue}>{formatValue(row.rmId)}</span>
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
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      ) : (
        <div>
          <div className="customer-layout-container">
          {/* Left Column: Summary Card — see the individual card above for why `styles.avatar`
              goes on the initials bubble rather than on the column. */}
          <div className="customer-left-column">
            {/* Blue circle avatar for company */}
            <div className={styles.avatar}>
               {getInitials(corporateProfile.organizationName)}
             </div>

            {/* Company Name */}
            <h3 className={styles.strong}>
              {formatCustomerName(corporateProfile.salutation, corporateProfile.organizationName)}
            </h3>
            <div className={styles.spacer10}>
              BRN: {corporateProfile.brn || '-'}
            </div>

            {/* Badges */}
            <div className={styles.badgeGroup}>
              <span className={styles.strong2}>
                Customer Status: {corporateProfile.lifecycleTrig || '-'}
              </span>
              {cleanSegmentValue(corporateProfile.segmentation) && (
                <span className={styles.segmentBadge}>
                  {cleanSegmentValue(corporateProfile.segmentation)}
                </span>
              )}
            </div>

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

              {canSeeContactsPanel && (
                <button
                  className={`left-tab-btn ${activeTab === 'contact_relationship' ? 'active' : ''}`}
                  onClick={() => setActiveTab('contact_relationship')}
                >
                  <Phone size={16} />
                  <span>Contact & Relationship</span>
                </button>
              )}

              <button
                className={`left-tab-btn ${activeTab === 'rmManager' ? 'active' : ''}`}
                onClick={() => setActiveTab('rmManager')}
              >
                <User size={16} />
                <span>RM Manager Information</span>
              </button>

              {canSeeProductsPanel && (
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
              )}

              {canSeeProductsPanel && (
                <button
                  className={`left-tab-btn ${activeTab === 'interestedProducts' ? 'active' : ''}`}
                  onClick={() => setActiveTab('interestedProducts')}
                >
                  <TrendingUp size={16} />
                  <span>Interested Products</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Content Workspace */}
          <div className="customer-right-column">

            <div
              className={
                ['overview', 'company_info', 'contact_relationship', 'rmManager'].includes(activeTab)
                  ? styles.contentPad
                  : styles.contentStack
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
                    <div className={cc.card}>
                      {/* Search & filters */}
                      <div className={cc.toolbar}>
                        <div className={cc.toolbarSearch}>
                          <SearchField
                            placeholder="Search corporate products..."
                            value={corpSearchQuery}
                            onValueChange={setCorpSearchQuery}
                            suggestions={corpSearchSuggestions}
                            onSelectSuggestion={(s) => setCorpSearchQuery(s.id)}
                            emptyHint="No matching products."
                          />
                        </div>
                        <div className={cc.toolbarActions}>
                          <RowsPerPage
                            storageKey="c360.corp.products"
                            value={pageSize}
                            onChange={(s) => {
                              setPageSize(s);
                              const customerId = corporateProfile.brn as string;
                              loadProducts(customerId, 1, s);
                            }}
                          />

                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => corporateProfile.brn && loadProducts(corporateProfile.brn as string, pageNumber, pageSize)}
                            disabled={loadingProducts}
                            leadingIcon={<RefreshCw size={14} className={loadingProducts ? 'animate-spin' : ''} />}
                          >
                            Refresh
                          </Button>
                        </div>
                      </div>

                      {/* Type and Status are filtered via their own column headers below; this bar
                          surfaces every active filter as a removable chip. */}
                      <FilterBar
                        filters={[
                          corpSearchQuery && { key: 'search', label: 'Search', value: `"${corpSearchQuery}"`, onRemove: () => setCorpSearchQuery('') },
                          corpTypeFilter && { key: 'type', label: 'Type', value: corpTypeFilter, onRemove: () => setCorpTypeFilter('') },
                          corpStatusFilter && { key: 'status', label: 'Status', value: corpStatusFilter, onRemove: () => setCorpStatusFilter('') },
                        ].filter(Boolean) as ActiveFilter[]}
                        onClearAll={() => {
                          setCorpSearchQuery('');
                          setCorpTypeFilter('');
                          setCorpStatusFilter('');
                        }}
                      />

                      {productsError ? (
                        <div className="error-container">
                          <p>{getFriendlyErrorMessage({ message: productsError ?? undefined, status: productsErrorStatus ?? undefined })}</p>
                          <Button onClick={() => loadProducts(corporateProfile.brn as string, pageNumber, pageSize)} className={styles.spacer9}>
                            Retry
                          </Button>
                        </div>
                      ) : (
                        <DataTable
                          bare
                          footer={
                            <Pagination
                              page={pageNumber}
                              pageSize={pageSize}
                              total={totalCount}
                              itemLabel="product"
                              onPageChange={(p) => loadProducts(corporateProfile.brn as string, p, pageSize)}
                            />
                          }
                        >
                          <ResponsiveRows
                            rows={corpData.filtered}
                            loading={loadingProducts}
                            loadingRows={pageSize}
                            rowKey={(item) => String(item.accountNumber)}
                            empty={
                              corpSearchQuery || corpTypeFilter || corpStatusFilter
                                ? 'No products match the selected filters. Try adjusting your search query or filters.'
                                : 'No corporate banking products found.'
                            }
                            columns={[
                              {
                                key: 'productName',
                                label: 'Product Name',
                                priority: 'always',
                                render: (item) => (
                                  <div>
                                    <div className={styles.strong4}>
                                      {formatValue(item.productName)}
                                    </div>
                                    {item.campaignCode && (
                                      <div className={cc.monoMeta}>
                                        Campaign: {item.campaignCode}
                                      </div>
                                    )}
                                  </div>
                                ),
                              },
                              {
                                key: 'category',
                                label: 'Type',
                                priority: 'always',
                                header: (
                                  <ColumnFilter
                                    label="Type"
                                    value={corpTypeFilter}
                                    onChange={setCorpTypeFilter}
                                    options={corpData.uniqueTypes.map((t) => ({ value: t, label: t }))}
                                    allLabel="All Types"
                                    searchable
                                  />
                                ),
                                render: (item) => (
                                  <span
                                    className={`${styles.typeChip}${item.type === 'Deposit' ? ` ${styles.typeChipDeposit}` : ''}`}
                                  >
                                    {formatValue(item.type || item.productCategory)}
                                  </span>
                                ),
                              },
                              {
                                key: 'accountNumber',
                                label: 'Account Number',
                                priority: 'high',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {formatValue(item.accountNumber)}
                                  </span>
                                ),
                              },
                              {
                                key: 'accountStatus',
                                label: 'Status',
                                priority: 'always',
                                header: (
                                  <ColumnFilter
                                    label="Status"
                                    value={corpStatusFilter}
                                    onChange={setCorpStatusFilter}
                                    options={corpData.uniqueStatuses.map((s) => ({ value: s, label: s }))}
                                    allLabel="All Statuses"
                                    searchable
                                  />
                                ),
                                render: (item) => (
                                  <StatusBadge
                                    status={resolveProductStatus(item)}
                                    dot={true}
                                  />
                                ),
                              },
                              {
                                key: 'balance',
                                label: 'Balance',
                                priority: 'high',
                                render: (item) => (
                                  <span className={cc.monoAccent}>
                                    {formatCurrency(item.balances)}
                                  </span>
                                ),
                              },
                              {
                                key: 'outstanding',
                                label: 'Outstanding',
                                priority: 'low',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {item.outstanding ? formatCurrency(item.outstanding) : EMPTY_VALUE}
                                  </span>
                                ),
                              },
                              {
                                key: 'tenureMaturity',
                                label: 'Tenure / Maturity',
                                priority: 'low',
                                render: (item) => (
                                  <div>
                                    {item.tenure ? <div className={cc.monoValue}>{item.tenure}</div> : null}
                                    {item.maturityDate ? (
                                      <div className={cc.monoMeta}>
                                        Matures: {item.maturityDate}
                                      </div>
                                    ) : null}
                                    {!item.tenure && !item.maturityDate && (
                                      <span className={cc.mutedText}>{EMPTY_VALUE}</span>
                                    )}
                                  </div>
                                ),
                              },
                              {
                                key: 'effectiveDate',
                                label: 'Opening Date',
                                priority: 'low',
                                render: (item) => (
                                  <span className={cc.monoValue}>
                                    {formatValue(
                                      item.accountOpeningDate ||
                                        item.commencementDate ||
                                        item.createdDate ||
                                        item.disbursedDate ||
                                        item.lastContactDate
                                    )}
                                  </span>
                                ),
                              },
                              {
                                key: 'action',
                                label: 'Action',
                                priority: 'always',
                                align: 'right',
                                render: (item) => (
                                  <RowAction
                                    onClick={() => openProductModal(item.accountNumber, (item.type || item.productCategory) as string)}
                                  />
                                ),
                              },
                            ]}
                          />
                        </DataTable>
                      )}
                    </div>
                  ) : (
                    <div className={cc.card}>
                      <DataTable bare minWidth={700}>
                        <ResponsiveRows
                          rows={[corporateProfile]}
                          rowKey={() => 'signatory'}
                          empty="No authorized signatories found."
                          columns={[
                            {
                              key: 'name',
                              label: 'Signatory Name',
                              priority: 'always',
                              render: (row) => (
                                <span className={styles.strong4}>
                                  {formatValue(formatCustomerName(row.signatorySalutation || row.salutation, row.signatoryName))}
                                </span>
                              ),
                            },
                            {
                              key: 'dob',
                              label: 'Date of Birth',
                              priority: 'low',
                              render: (row) => formatValue(row.signatoryDateOfBirth),
                            },
                            {
                              key: 'id',
                              label: 'ID Number',
                              priority: 'always',
                              render: (row) => (
                                <div className={styles.spread2}>
                                  <span className={cc.monoValue}>
                                    {revealed['sigId']
                                      ? formatValue(row.signatoryIdNumber)
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
                                  <span className={cc.monoValue}>
                                    {revealed['sigPhone']
                                      ? formatValue(row.signatoryPhoneNumber)
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
                              render: (row) => formatValue(row.signatoryPosition),
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
                <div className={cc.card}>
                  <DataTable bare minWidth={600}>
                    <ResponsiveRows
                      rows={
                        profile.interestedProductName || profile.interestedProductCategory
                          ? [profile]
                          : []
                      }
                      rowKey={() => 'interested-product-corporate'}
                      empty="No interested products found."
                      columns={[
                        {
                          key: 'name',
                          label: 'Product Name',
                          priority: 'always',
                          render: (row) => (
                            <span className={styles.strong4}>
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
