import { canSeeProfilePanel } from '../api/hostBridge';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useCustomerStore, readSavedCustomer, clearSavedCustomer } from '../store/customerStore';
import { useInteractionStore } from '../store/interactionStore';
import { useProductStore } from '../store/productStore';
import { api, ApiError } from '../services/api';
import { getFriendlyErrorMessage, idTypeToFriendlyLabel } from '../utils/errorMessages';
import { maskPhone, maskNRIC, maskTIN } from '../utils/masking';
import CustomerHeader from '../components/CustomerHeader';
import CustomerHeroBanner, { CustomerHeroBannerSkeleton } from '../components/CustomerHeroBanner';
import IndividualDetails from '../components/IndividualDetails';
import CaseDetailsModal from '../components/CaseDetailsModal';
import ProductDetailsModal from '../components/ProductDetailsModal';
import DynamicProfileSection, { groupBySection } from '../components/DynamicProfileSection';
import CustomerLeadListing from '../components/CustomerLeadListing';
import { useLeadStore } from '../store/leadStore';
import { useFieldReveal } from '../hooks/useFieldReveal';
import { Eye, EyeOff, ChevronRight, ChevronDown, SlidersHorizontal, Building2, Layers, User, Briefcase, Globe, Shield, FileText, Calendar, DollarSign, MapPin, Mail, Phone, TrendingUp, Search, RotateCcw, RefreshCw, AlertCircle, Loader2, Sparkles, FolderKanban } from '@omniconnect/ui/icons';
import { useHostNavigate } from '../navigation/HostNavigation';
import type {
  IndividualProfile,
  CorporateProfile,
  CustomerProfile,
  CustomerProduct,
  Interaction,
  LookupOptions,
  FieldConfig,
  ContactDetail,
} from '../types/api';

import { DEFAULT_INDIVIDUAL_FIELD_CONFIGS, DEFAULT_CORPORATE_FIELD_CONFIGS } from '../constants/defaultFieldConfigs';
import styles from './Customer360.module.css';
import cc from '../shared/c360Common.module.css';
import { Button, ColumnFilter, DataTable, EMPTY_VALUE, EmptyState, FilterBar, Input, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, Select, getInitials, sanitizeFilterInput, useDebouncedValue, type ActiveFilter, type FilterInputType } from '@omniconnect/ui';
import { StatusBadge } from '../shared/StatusBadge';
import { formatValue, formatCurrency as formatMoney, resolveProductStatus } from '../shared/formatValue';
import { formatCustomerName, cleanSegmentValue } from '../utils/customerProfileFormatters';
import { useShallow } from 'zustand/react/shallow';

function resolveProfileCustomerId(p: CustomerProfile | null, isInd: boolean): string {
  if (!p) return '';
  if (isInd) {
    const ip = p as IndividualProfile;
    return (ip.nationalId || ip.phprId || '').trim();
  }
  const cp = p as CorporateProfile;
  return (cp.brn || cp.customerId || cp.cifNumber || '').trim();
}


interface CorporateOverviewProps {
  profile?: CorporateProfile | null;
  contactInfo?: ContactDetail | null;
  fieldConfigs?: FieldConfig[];
  revealed?: Record<string, boolean>;
  onToggleReveal?: (fieldKey: string, fieldLabel: string, realVal: string) => void;
  loading?: boolean;
}

function CorporateOverview({
  profile = null,
  contactInfo = null,
  fieldConfigs = [],
  revealed = {},
  onToggleReveal = () => {},
  loading = false,
}: CorporateOverviewProps) {
  const effectiveCorpConfigs =
    fieldConfigs && fieldConfigs.length > 0
      ? fieldConfigs
      : DEFAULT_CORPORATE_FIELD_CONFIGS;

  const col1SectionNames = ['Company Details', 'Online Banking Status', 'Company Information'];
  const col2SectionNames = [
    'Contact Information',
    'Business Registration',
    'Referrer & Relationship Information',
    'RM Manager Information',
  ];

  const col1Configs = effectiveCorpConfigs
    .filter((f) => col1SectionNames.includes(f.section))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const col2Configs = effectiveCorpConfigs
    .filter((f) => col2SectionNames.includes(f.section))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const col1Grouped = groupBySection(col1Configs);
  const col2Grouped = groupBySection(col2Configs);

  return (
    <div className={styles.corpOverviewGrid}>
      <div className={styles.corpOverviewCol}>
        {col1Grouped.map(({ section, fields }) => (
          <DynamicProfileSection
            key={section}
            section={section}
            fields={fields}
            profile={profile}
            contactInfo={contactInfo}
            revealed={revealed}
            onToggleReveal={onToggleReveal}
            loading={loading}
          />
        ))}
      </div>
      <div className={styles.corpOverviewCol}>
        {col2Grouped.map(({ section, fields }) => (
          <DynamicProfileSection
            key={section}
            section={section}
            fields={fields}
            profile={profile}
            contactInfo={contactInfo}
            revealed={revealed}
            onToggleReveal={onToggleReveal}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}

interface ProfileWorkspaceSkeletonProps {
  isIndividual: boolean;
  individualFieldConfigs?: FieldConfig[];
  corporateFieldConfigs?: FieldConfig[];
}

function ProfileWorkspaceSkeleton({
  isIndividual,
  individualFieldConfigs = [],
  corporateFieldConfigs = [],
}: ProfileWorkspaceSkeletonProps) {
  return (
    <div className={styles.workspaceWrapper} aria-busy="true">
      {/* 1. Customer Hero Banner Skeleton */}
      <CustomerHeroBannerSkeleton isIndividual={isIndividual} />

      {/* 2. Horizontal Navigation Tabs Bar — matches live page layout */}
      <div className={styles.mainNavBar}>
        <div className={styles.mainTabsList}>
          <button
            type="button"
            className={`${styles.mainTabBtn} ${styles.mainTabBtnActive}`}
            disabled
          >
            {isIndividual ? <User size={15} /> : <Building2 size={15} />}
            <span>{isIndividual ? 'Overview' : 'Company Overview'}</span>
          </button>

          <button type="button" className={styles.mainTabBtn} disabled>
            <FileText size={15} />
            <span>User Interaction</span>
          </button>

          <button type="button" className={styles.mainTabBtn} disabled>
            <Layers size={15} />
            <span>{isIndividual ? 'Product Held' : 'Product Holdings & Signatories'}</span>
          </button>

          <button type="button" className={styles.mainTabBtn} disabled>
            <FolderKanban size={15} />
            <span>Lead Listing</span>
          </button>
        </div>
      </div>

      {/* 2. Current Structure of Balanced 2-Column Boxes */}
      <div className={styles.tabContentContainer}>
        {isIndividual ? (
          <IndividualDetails
            subTab="overview"
            fieldConfigs={individualFieldConfigs}
            loading={true}
          />
        ) : (
          <CorporateOverview
            fieldConfigs={corporateFieldConfigs}
            loading={true}
          />
        )}
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

  const { totalCount: totalLeadCount } = useLeadStore(useShallow((s) => ({ totalCount: s.totalCount })));

  const navigate = useHostNavigate();

  // Adjust tabs based on customerType
  const isIndividual = customerType === 'individual';

  // Tab states: 'overview', 'user_interactions', 'products', 'leads'
  const [activeTab, setActiveTab] = useState('overview');

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

  // Criteria for querying customer leads dynamically
  const customerLeadCriteria = useMemo(() => {
    if (!profile) return { icNumber: '', name: '' };
    if (isIndividual) {
      const ind = profile as IndividualProfile;
      return {
        icNumber: (ind.nationalId || ind.phprId || '').trim(),
        name: (ind.fullName || '').trim(),
      };
    }
    const corp = profile as CorporateProfile;
    return {
      icNumber: (corp.brn || corp.customerId || corp.cifNumber || '').trim(),
      name: (corp.organizationName || '').trim(),
    };
  }, [isIndividual, profile]);

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
  const debouncedIndSearchQuery = useDebouncedValue(indSearchQuery, 100);
  const debouncedCorpSearchQuery = useDebouncedValue(corpSearchQuery, 100);
  const debouncedIntSearchQuery = useDebouncedValue(intSearchQuery, 100);

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
    useProductStore.setState({ products: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1 });
    useInteractionStore.setState({ interactions: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1 });
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
    useProductStore.setState({ products: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1 });
    useInteractionStore.setState({ interactions: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1 });
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

  const lastIntCustRef = useRef<string | null>(null);
  // Load interactions when profile changes
  useEffect(() => {
    // Skipped outright when the panel was not granted: the endpoint answers 403, and the store would
    // record that as a load failure the user then sees as an error on a panel they cannot open.
    if (profile && canSeeInteractionsPanel) {
      const customerId = resolveProfileCustomerId(profile, isIndividual);
      if (lastIntCustRef.current !== customerId) {
        lastIntCustRef.current = customerId;
        useInteractionStore.setState({ interactions: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1 });
      }
      if (customerId) {
        loadInteractions(customerId);
      }
    }
  }, [profile, isIndividual, canSeeInteractionsPanel]);

  // Load products based on profile and store pagination state
  const lastParamsRef = useRef<{ customerId: string | null | undefined; pageNumber: number | null; pageSize: number | null }>({ customerId: null, pageNumber: null, pageSize: null });

  useEffect(() => {
    if (profile && canSeeProductsPanel) {
      const customerId = resolveProfileCustomerId(profile, isIndividual);
      const isNewCustomer = lastParamsRef.current.customerId !== customerId;

      // A new customer always needs a fresh fetch at page 1 — full stop.
      // Cleanly reset current products and counts immediately so stale data from prior customers does not linger.
      if (isNewCustomer) {
        lastParamsRef.current = { customerId, pageNumber: 1, pageSize: 5 };
        useProductStore.setState({ products: [], totalCount: 0, totalPages: 1, error: null, errorStatus: null, pageNumber: 1, pageSize: 5 });
        if (customerId) {
          loadProducts(customerId, 1, 5);
        }
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

    setActiveTab('overview');
    setActiveSubTab('');
  }, [customerType]);

  // Restoring a customer after refresh — show a neutral loading state, never
  // the search form (which would flash briefly before swapping to the
  // restored workspace) and never a stale/empty table.
  if (bootstrapping) {
    return (
      <ProfileWorkspaceSkeleton
        isIndividual={isIndividual}
        individualFieldConfigs={individualFieldConfigs}
        corporateFieldConfigs={corporateFieldConfigs}
      />
    );
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
        (item.type || item.productCategory || '').toLowerCase().includes(query) ||
        (resolveProductStatus(item) || '').toLowerCase().includes(query) ||
        (item.campaignCode || '').toLowerCase().includes(query) ||
        (item.cardType || '').toLowerCase().includes(query) ||
        (item.balances || '').toLowerCase().includes(query) ||
        (item.outstanding || '').toLowerCase().includes(query);

      const matchesType = !typeF || (item.type || item.productCategory || '') === typeF;
      const matchesStatus = !statusF || resolveProductStatus(item) === statusF;

      return matchesSearch && matchesType && matchesStatus;
    });

    return { filtered, uniqueTypes, uniqueStatuses };
  };

  const indData = getFilteredAndUnique(true);
  const corpData = getFilteredAndUnique(false);

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
        (item.classification || item.subCategory1 || '').toLowerCase().includes(query) ||
        (item.description || '').toLowerCase().includes(query) ||
        (item.channelTo || '').toLowerCase().includes(query) ||
        (item.branchName || '').toLowerCase().includes(query) ||
        (item.actionSummary || '').toLowerCase().includes(query);

      const matchesStatus = !statusF || (getLegacyInteractionField(item, 'status') || item.statusParent || '') === statusF;

      return matchesSearch && matchesStatus;
    });

    // 2. Unique statuses
    const uniqueStatuses = Array.from(new Set(interactions.map(item => getLegacyInteractionField(item, 'status') || item.statusParent || '').filter(Boolean)));

    return { filtered, uniqueStatuses };
  };

  const intData = getFilteredInteractions();

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
          <div className={styles.searchBarRow}>
            <div className={styles.searchControlsGroup}>
              {/* ID Type Select */}
              <div className={styles.selectGroup}>
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
              {searchIdType === 'SecondaryID' && (
                <div className={styles.selectGroup}>
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
              )}

              {/* Search Input — compact & elegant size */}
              {searchIdType && (searchIdType !== 'SecondaryID' || searchSubtype) && (
                <div className={styles.inputGroup}>
                  <Input
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
                      const filterType: FilterInputType =
                        searchIdType === 'Phone' || searchIdType === 'NRIC' ? 'numeric' :
                          searchIdType === 'Name' ? 'alpha' : 'text';
                      setSearchVal(sanitizeFilterInput(e.target.value, filterType));
                      setSearchError('');
                    }}
                    autoFocus
                  />
                </div>
              )}

              {/* Action Button */}
              <div className={styles.actionBtnGroup}>
                <Button
                  type="submit"
                  loading={loadingSearch}
                  disabled={!searchIdType || !searchVal}
                  leadingIcon={<Search size={15} />}
                >
                  {loadingSearch ? 'Searching...' : 'Search Profile'}
                </Button>
              </div>
            </div>
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
          <div className={styles.searchBarRow}>
            <div className={styles.searchControlsGroup}>
              {/* Search Type Select */}
              <div className={styles.selectGroup}>
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

              {/* Search Input — compact & elegant size */}
              {corpSearchType && (
                <div className={styles.inputGroup}>
                  <Input
                    label={
                      corpSearchType === 'BRN' ? 'BRN (Business Registration)' :
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
                </div>
              )}

              {/* Action Buttons */}
              <div className={styles.actionBtnGroup}>
                <Button
                  type="submit"
                  loading={loadingCorpSearch}
                  disabled={!corpSearchType || !corpSearchVal}
                  leadingIcon={<Search size={15} />}
                >
                  {loadingCorpSearch ? 'Searching...' : 'Search Company'}
                </Button>
              </div>
            </div>
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
   * Loading state: as soon as a search is initiated or customer profile is loading,
   * the search panel and header immediately disappear. In its place, the profile workspace
   * skeleton (including Hero Banner shimmer) renders in the exact final layout, providing
   * seamless visual synchronization without any layout shifting or lingering search header.
   */
  if (loading || loadingSearch || loadingCorpSearch) {
    return (
      <ProfileWorkspaceSkeleton
        isIndividual={isIndividual}
        individualFieldConfigs={individualFieldConfigs}
        corporateFieldConfigs={corporateFieldConfigs}
      />
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
    <div className={styles.workspaceWrapper}>
      {/* 1. Customer Hero Banner */}
      <CustomerHeroBanner
        profile={profile}
        contactInfo={contactInfo}
        customerType={customerType}
        products={products}
        interactions={interactions}
        totalProductsCount={totalCount}
        onSearchClick={isIndividual ? handleBackToSearch : handleBackToSearchCorp}
      />

      {/* 2. Top-level Horizontal Navigation Tabs */}
      <div className={styles.mainNavBar}>
        <div className={styles.mainTabsList}>
          <button
            type="button"
            className={`${styles.mainTabBtn} ${activeTab === 'overview' ? styles.mainTabBtnActive : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            {isIndividual ? <User size={15} /> : <Building2 size={15} />}
            <span>{isIndividual ? 'Overview' : 'Company Overview'}</span>
          </button>

          {canSeeInteractionsPanel && (
            <button
              type="button"
              className={`${styles.mainTabBtn} ${activeTab === 'user_interactions' ? styles.mainTabBtnActive : ''}`}
              onClick={() => setActiveTab('user_interactions')}
            >
              <FileText size={15} />
              <span>User Interaction</span>
              {interactions.length > 0 && (
                <span className={styles.mainTabCount}>{interactions.length}</span>
              )}
            </button>
          )}

          {canSeeProductsPanel && (
            <button
              type="button"
              className={`${styles.mainTabBtn} ${activeTab === 'products' ? styles.mainTabBtnActive : ''}`}
              onClick={() => setActiveTab('products')}
            >
              <Layers size={15} />
              <span>{isIndividual ? 'Product Held' : 'Product Holdings & Signatories'}</span>
              {(totalCount > 0 || products.length > 0) && (
                <span className={styles.mainTabCount}>{totalCount || products.length}</span>
              )}
            </button>
          )}

          <button
            type="button"
            className={`${styles.mainTabBtn} ${activeTab === 'leads' ? styles.mainTabBtnActive : ''}`}
            onClick={() => setActiveTab('leads')}
          >
            <FolderKanban size={15} />
            <span>Lead Listing</span>
            {totalLeadCount > 0 && (
              <span className={styles.mainTabCount}>{totalLeadCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className={styles.tabContentContainer}>
        {isIndividual ? (
          <div>
            {/* DETAILS TABS & WORKSPACE DIRECT SECTIONS */}
            {['overview', 'personal_details', 'residency_contact_details', 'employment_details', 'additional_relationship_details', 'personal', 'residency_details', 'residency', 'contact_details', 'contact', 'employment', 'additional_details', 'additional', 'details'].includes(activeTab) && (
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

                {/* Status is filtered via the column header below; this bar surfaces active status filter */}
                <FilterBar
                  filters={[
                    intStatusFilter && { key: 'status', label: 'Status', value: intStatusFilter, onRemove: () => setIntStatusFilter('') },
                  ].filter(Boolean) as ActiveFilter[]}
                  onClearAll={() => {
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
                      rowKey={(item, index) => String(item.caseId || `case-${index}`) + `-${index}`}
                      empty={
                        <EmptyState
                          compact
                          title={intSearchQuery || intStatusFilter ? 'No matching interactions' : 'No interactions recorded'}
                          description={
                            intSearchQuery || intStatusFilter
                              ? 'No interactions match the selected filters. Try adjusting your search query or filters.'
                              : 'No customer interactions recorded yet.'
                          }
                        />
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
                            <button
                              type="button"
                              className={styles.viewActionBtn}
                              onClick={() => openCaseModal(item)}
                              title="View interaction details"
                            >
                              <Eye size={13} className={styles.viewActionIcon} />
                              <span>View</span>
                            </button>
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
                {/* Approval-style Subtab Navigation */}
                <div className={styles.subNavBar}>
                  <div className={styles.subTabsList}>
                    <button
                      type="button"
                      className={`${styles.subTabBtn} ${productsTab === 'held' ? styles.subTabBtnActive : ''}`}
                      onClick={() => setProductsTab('held')}
                    >
                      <Layers size={16} />
                      <span>Product Held</span>
                      <span className={styles.subTabPill}>{totalCount || indData.filtered.length}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.subTabBtn} ${productsTab === 'interested' ? styles.subTabBtnActive : ''}`}
                      onClick={() => setProductsTab('interested')}
                    >
                      <Sparkles size={16} />
                      <span>Interested Products</span>
                      {(profile.interestedProductName || profile.interestedProductCategory) && (
                        <span className={styles.subTabPill}>1</span>
                      )}
                    </button>
                  </div>
                </div>

                {productsTab === 'held' && (
                  <div className={cc.card}>
                    {/* Summary Bar */}
                    <div className={styles.tableSummaryBar}>
                      <div className={styles.summaryBadgeGroup}>
                        <span className={`${styles.summaryPill} ${styles.summaryPillPrimary}`}>
                          <Layers size={13} />
                          {totalCount || indData.filtered.length} Holdings
                        </span>
                        {indData.uniqueTypes.length > 0 && (
                          <span className={styles.summaryPill}>
                            {indData.uniqueTypes.length} Product {indData.uniqueTypes.length === 1 ? 'Type' : 'Types'}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Controls Toolbar */}
                    <div className={cc.toolbar}>
                      <div className={cc.toolbarSearch}>
                        <SearchField
                          placeholder="Search products by name, account number..."
                          value={indSearchQuery}
                          onValueChange={(val) => {
                            setIndSearchQuery(val);
                            setPageNumber(1);
                          }}
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

                    {/* Type and Status are filtered via their own column headers below */}
                    <FilterBar
                      filters={[
                        indTypeFilter && { key: 'type', label: 'Type', value: indTypeFilter, onRemove: () => setIndTypeFilter('') },
                        indStatusFilter && { key: 'status', label: 'Status', value: indStatusFilter, onRemove: () => setIndStatusFilter('') },
                      ].filter(Boolean) as ActiveFilter[]}
                      onClearAll={() => {
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
                            total={(indSearchQuery || indTypeFilter || indStatusFilter) ? indData.filtered.length : totalCount}
                            itemLabel="product"
                            onPageChange={(p) => loadProducts(individualProfile.nationalId as string, p, pageSize)}
                          />
                        }
                      >
                        <ResponsiveRows
                          rows={indData.filtered}
                          loading={loadingProducts}
                          loadingRows={pageSize}
                          rowKey={(item, index) =>
                            String(
                              item.accountNumber ||
                              getLegacyProductField(item, 'accountNo') ||
                              item.phprId ||
                              `ind-prod-${index}`
                            ) + `-${index}`
                          }
                          empty={
                            <EmptyState
                              compact
                              title={indSearchQuery || indTypeFilter || indStatusFilter ? 'No matching products' : 'No banking products'}
                              description={
                                indSearchQuery || indTypeFilter || indStatusFilter
                                  ? 'No products match the selected filters. Try adjusting your search query or filters.'
                                  : 'No active banking products found for this customer.'
                              }
                            />
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
                                <button
                                  type="button"
                                  className={styles.viewActionBtn}
                                  onClick={() =>
                                    openProductModal(
                                      (item.accountNumber ||
                                        getLegacyProductField(item, 'accountNo')) as string,
                                      (item.type || item.productCategory) as string
                                    )
                                  }
                                  title="View product details"
                                >
                                  <Eye size={13} className={styles.viewActionIcon} />
                                  <span>View</span>
                                </button>
                              ),
                            },
                          ]}
                        />
                      </DataTable>
                    )}
                  </div>
                )}

                {productsTab === 'interested' && (
                  <div>
                    {(profile.interestedProductName || profile.interestedProductCategory) && (
                      <div className={styles.interestedCard}>
                        <div className={styles.interestedHeader}>
                          <div className={styles.interestedIconBadge}>
                            <Sparkles size={22} />
                          </div>
                          <div>
                            <h3 className={styles.interestedTitle}>Interested Products & Recommendations</h3>
                            <p className={styles.interestedHint}>
                              Propensity model insights and tailored campaign recommendations for this customer.
                            </p>
                          </div>
                        </div>
                        <div className={styles.interestedGrid}>
                          <div className={styles.interestedItem}>
                            <span className={styles.interestedLabel}>Product Name</span>
                            <span className={styles.interestedValue}>
                              {formatValue(profile.interestedProductName)}
                            </span>
                          </div>
                          <div className={styles.interestedItem}>
                            <span className={styles.interestedLabel}>Category</span>
                            <span className={styles.interestedValue}>
                              {formatValue(profile.interestedProductCategory)}
                            </span>
                          </div>
                          <div className={styles.interestedItem}>
                            <span className={styles.interestedLabel}>Engagement Count</span>
                            <span className={styles.interestedValue}>
                              {formatValue(profile.engagementCount)}
                            </span>
                          </div>
                          <div className={styles.interestedItem}>
                            <span className={styles.interestedLabel}>Eligibility Score</span>
                            <span className={styles.interestedValue}>
                              {formatValue(profile.eligibilityScore)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={cc.card}>
                      <DataTable bare minWidth={600}>
                        <ResponsiveRows
                          rows={
                            profile.interestedProductName || profile.interestedProductCategory
                              ? [profile]
                              : []
                          }
                          rowKey={(_row, index) => `interested-product-${index}`}
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
                    rowKey={(_row, index) => `relationship-manager-${index}`}
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

            {/* 3. INDIVIDUAL LEAD LISTING */}
            {activeTab === 'leads' && (
              <CustomerLeadListing criteria={customerLeadCriteria} />
            )}
          </div>
        ) : (
          <div>
            {/* 1. CORPORATE OVERVIEW (2-Column Balanced Grid across full screen width) */}
            {activeTab === 'overview' && (
              <CorporateOverview
                profile={corporateProfile}
                contactInfo={contactInfo}
                fieldConfigs={corporateFieldConfigs}
                revealed={corpFieldReveal.revealed}
                onToggleReveal={corpFieldReveal.toggleReveal}
              />
            )}

            {/* 2. CORPORATE USER INTERACTIONS */}
            {activeTab === 'user_interactions' && (
              <div className={cc.card}>
                <div className={cc.toolbar}>
                  <div className={cc.toolbarSearch}>
                    <SearchField
                      placeholder="Search interactions by case ID, category..."
                      value={intSearchQuery}
                      onValueChange={(val) => {
                        setIntSearchQuery(val);
                        setIntPageNumber(1);
                      }}
                    />
                  </div>
                  <div className={cc.toolbarActions}>
                    <RowsPerPage
                      storageKey="c360.corp.interactions"
                      value={intPageSize}
                      onChange={(s) => {
                        setIntPageSize(s);
                        setIntPageNumber(1);
                      }}
                    />

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const corpId = resolveProfileCustomerId(corporateProfile, false);
                        if (corpId) loadInteractions(corpId, { fresh: true });
                      }}
                      disabled={loadingInteractions}
                      leadingIcon={<RefreshCw size={14} className={loadingInteractions ? 'animate-spin' : ''} />}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                <FilterBar
                  filters={[
                    intStatusFilter && { key: 'status', label: 'Status', value: intStatusFilter, onRemove: () => setIntStatusFilter('') },
                  ].filter(Boolean) as ActiveFilter[]}
                  onClearAll={() => {
                    setIntStatusFilter('');
                    setIntPageNumber(1);
                  }}
                />

                {interactionsError ? (
                  <div className="error-container">
                    <p>{getFriendlyErrorMessage({ message: interactionsError ?? undefined, status: interactionsErrorStatus ?? undefined })}</p>
                    <Button
                      onClick={() => {
                        const corpId = resolveProfileCustomerId(corporateProfile, false);
                        if (corpId) loadInteractions(corpId);
                      }}
                      className={styles.spacer9}
                    >
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
                      rowKey={(item, index) => String(item.caseId || `case-${index}`) + `-${index}`}
                      empty={
                        <EmptyState
                          compact
                          title={intSearchQuery || intStatusFilter ? 'No matching interactions' : 'No interactions recorded'}
                          description={
                            intSearchQuery || intStatusFilter
                              ? 'No interactions match the selected filters. Try adjusting your search query or filters.'
                              : 'No customer interactions recorded for this company.'
                          }
                        />
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
                            <button
                              type="button"
                              className={styles.viewActionBtn}
                              onClick={() => openCaseModal(item)}
                              title="View interaction details"
                            >
                              <Eye size={13} className={styles.viewActionIcon} />
                              <span>View</span>
                            </button>
                          ),
                        },
                      ]}
                    />
                  </DataTable>
                )}
              </div>
            )}

            {/* 3. CORPORATE PRODUCTS & SIGNATORIES TAB */}
            {(activeTab === 'products' || activeTab === 'products_signatories') && (
              <div>
                {/* Approval-style Subtab Navigation */}
                <div className={styles.subNavBar}>
                  <div className={styles.subTabsList}>
                    <button
                      type="button"
                      className={`${styles.subTabBtn} ${corpSubTab === 'products' ? styles.subTabBtnActive : ''}`}
                      onClick={() => setCorpSubTab('products')}
                    >
                      <Layers size={16} />
                      <span>Products Held</span>
                      <span className={styles.subTabPill}>{totalCount || corpData.filtered.length}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.subTabBtn} ${corpSubTab === 'signatories' ? styles.subTabBtnActive : ''}`}
                      onClick={() => setCorpSubTab('signatories')}
                    >
                      <Shield size={16} />
                      <span>Signatories</span>
                      <span className={styles.subTabPill}>
                        {corporateProfile.signatoryName ? '1' : '0'}
                      </span>
                    </button>
                  </div>
                </div>

                {corpSubTab === 'products' ? (
                  <div className={cc.card}>
                    {/* Summary Bar */}
                    <div className={styles.tableSummaryBar}>
                      <div className={styles.summaryBadgeGroup}>
                        <span className={`${styles.summaryPill} ${styles.summaryPillPrimary}`}>
                          <Layers size={13} />
                          {totalCount || corpData.filtered.length} Corporate Facilities
                        </span>
                        {corpData.uniqueTypes.length > 0 && (
                          <span className={styles.summaryPill}>
                            {corpData.uniqueTypes.length} Product {corpData.uniqueTypes.length === 1 ? 'Type' : 'Types'}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Search & filters */}
                    <div className={cc.toolbar}>
                      <div className={cc.toolbarSearch}>
                        <SearchField
                          placeholder="Search corporate products..."
                          value={corpSearchQuery}
                          onValueChange={(val) => {
                            setCorpSearchQuery(val);
                            setPageNumber(1);
                          }}
                        />
                      </div>
                      <div className={cc.toolbarActions}>
                        <RowsPerPage
                          storageKey="c360.corp.products"
                          value={pageSize}
                          onChange={(s) => {
                            setPageSize(s);
                            const corpId = resolveProfileCustomerId(corporateProfile, false);
                            if (corpId) loadProducts(corpId, 1, s);
                          }}
                        />

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            const corpId = resolveProfileCustomerId(corporateProfile, false);
                            if (corpId) loadProducts(corpId, pageNumber, pageSize);
                          }}
                          disabled={loadingProducts}
                          leadingIcon={<RefreshCw size={14} className={loadingProducts ? 'animate-spin' : ''} />}
                        >
                          Refresh
                        </Button>
                      </div>
                    </div>

                    {/* Type and Status are filtered via their own column headers below */}
                    <FilterBar
                      filters={[
                        corpTypeFilter && { key: 'type', label: 'Type', value: corpTypeFilter, onRemove: () => setCorpTypeFilter('') },
                        corpStatusFilter && { key: 'status', label: 'Status', value: corpStatusFilter, onRemove: () => setCorpStatusFilter('') },
                      ].filter(Boolean) as ActiveFilter[]}
                      onClearAll={() => {
                        setCorpTypeFilter('');
                        setCorpStatusFilter('');
                      }}
                    />

                    {productsError ? (
                      <div className="error-container">
                        <p>{getFriendlyErrorMessage({ message: productsError ?? undefined, status: productsErrorStatus ?? undefined })}</p>
                        <Button
                          onClick={() => {
                            const corpId = resolveProfileCustomerId(corporateProfile, false);
                            if (corpId) loadProducts(corpId, pageNumber, pageSize);
                          }}
                          className={styles.spacer9}
                        >
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
                            total={(corpSearchQuery || corpTypeFilter || corpStatusFilter) ? corpData.filtered.length : totalCount}
                            itemLabel="product"
                            onPageChange={(p) => {
                              const corpId = resolveProfileCustomerId(corporateProfile, false);
                              if (corpId) loadProducts(corpId, p, pageSize);
                            }}
                          />
                        }
                      >
                        <ResponsiveRows
                          rows={corpData.filtered}
                          loading={loadingProducts}
                          loadingRows={pageSize}
                          rowKey={(item, index) =>
                            String(
                              item.accountNumber ||
                              getLegacyProductField(item, 'accountNo') ||
                              item.phprId ||
                              `corp-prod-${index}`
                            ) + `-${index}`
                          }
                          empty={
                            <EmptyState
                              compact
                              title={corpSearchQuery || corpTypeFilter || corpStatusFilter ? 'No matching facilities' : 'No corporate facilities'}
                              description={
                                corpSearchQuery || corpTypeFilter || corpStatusFilter
                                  ? 'No products match the selected filters. Try adjusting your search query or filters.'
                                  : 'No corporate banking products or facilities held for this organization.'
                              }
                            />
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
                                <button
                                  type="button"
                                  className={styles.viewActionBtn}
                                  onClick={() =>
                                    openProductModal(
                                      item.accountNumber,
                                      (item.type || item.productCategory) as string
                                    )
                                  }
                                  title="View product details"
                                >
                                  <Eye size={13} className={styles.viewActionIcon} />
                                  <span>View</span>
                                </button>
                              ),
                            },
                          ]}
                        />
                      </DataTable>
                    )}
                  </div>
                ) : (
                  <div>
                    {corporateProfile.signatoryName && (
                      <div className={styles.signatoryCard}>
                        <div className={styles.signatoryCardHeader}>
                          <div className={styles.signatoryAvatar}>
                            {getInitials(corporateProfile.signatoryName) || 'SG'}
                          </div>
                          <div className={styles.signatoryInfo}>
                            <div className={styles.signatoryNameRow}>
                              <h3 className={styles.signatoryName}>
                                {formatValue(formatCustomerName(corporateProfile.signatorySalutation || corporateProfile.salutation, corporateProfile.signatoryName))}
                              </h3>
                              <span className={styles.signatoryBadge}>
                                <Shield size={12} />
                                Primary Signatory
                              </span>
                            </div>
                            <div className={styles.signatoryPosition}>
                              {formatValue(corporateProfile.signatoryPosition || 'Authorized Officer / Director')}
                            </div>
                          </div>
                        </div>

                        <div className={styles.signatoryGrid}>
                          <div className={styles.signatoryField}>
                            <span className={styles.signatoryFieldLabel}>Signatory ID</span>
                            <div className={styles.signatoryFieldValue}>
                              <span className={cc.monoValue}>
                                {revealed['sigId']
                                  ? formatValue(corporateProfile.signatoryIdNumber)
                                  : maskNRIC(corporateProfile.signatoryIdNumber)}
                              </span>
                              {corporateProfile.signatoryIdNumber &&
                                corporateProfile.signatoryIdNumber.trim() !== '' &&
                                corporateProfile.signatoryIdNumber.toLowerCase() !== 'null' && (
                                  <button
                                    onClick={() =>
                                      handleToggleReveal(
                                        'sigId',
                                        'Signatory ID Number',
                                        corporateProfile.signatoryIdNumber!
                                      )
                                    }
                                    className={styles.row12}
                                    title={revealed['sigId'] ? 'Hide details' : 'Reveal details'}
                                  >
                                    {revealed['sigId'] ? <EyeOff size={14} /> : <Eye size={14} />}
                                  </button>
                                )}
                            </div>
                          </div>

                          <div className={styles.signatoryField}>
                            <span className={styles.signatoryFieldLabel}>Contact Phone</span>
                            <div className={styles.signatoryFieldValue}>
                              <span className={cc.monoValue}>
                                {revealed['sigPhone']
                                  ? formatValue(corporateProfile.signatoryPhoneNumber)
                                  : maskPhone(corporateProfile.signatoryPhoneNumber)}
                              </span>
                              {corporateProfile.signatoryPhoneNumber &&
                                corporateProfile.signatoryPhoneNumber.trim() !== '' &&
                                corporateProfile.signatoryPhoneNumber.toLowerCase() !== 'null' && (
                                  <button
                                    onClick={() =>
                                      handleToggleReveal(
                                        'sigPhone',
                                        'Signatory Phone Number',
                                        corporateProfile.signatoryPhoneNumber!
                                      )
                                    }
                                    className={styles.row12}
                                    title={revealed['sigPhone'] ? 'Hide details' : 'Reveal details'}
                                  >
                                    {revealed['sigPhone'] ? <EyeOff size={14} /> : <Eye size={14} />}
                                  </button>
                                )}
                            </div>
                          </div>

                          <div className={styles.signatoryField}>
                            <span className={styles.signatoryFieldLabel}>Date of Birth</span>
                            <span className={styles.signatoryFieldValue}>
                              {formatValue(corporateProfile.signatoryDateOfBirth)}
                            </span>
                          </div>

                          <div className={styles.signatoryField}>
                            <span className={styles.signatoryFieldLabel}>Mandate Authority</span>
                            <span className={styles.signatoryFieldValue}>
                              Authorized Representative
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={cc.card}>
                      <DataTable bare minWidth={700}>
                        <ResponsiveRows
                          rows={[corporateProfile]}
                          rowKey={(_row, index) => `signatory-${index}`}
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
                    rowKey={(_row, index) => `interested-product-corporate-${index}`}
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

            {/* 4. CORPORATE LEAD LISTING */}
            {activeTab === 'leads' && (
              <CustomerLeadListing criteria={customerLeadCriteria} />
            )}
          </div>
        )}
      </div>


      {/* Modals */}
      <CaseDetailsModal />
      <ProductDetailsModal />
    </div>
  );
}
