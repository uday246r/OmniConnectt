# Graph Report - OmniRemit  (2026-09-02)

## Corpus Check
- 451 files · ~307,231 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4209 nodes · 8289 edges · 230 communities (208 shown, 14 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 440 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `de1be4dd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- KpiSummaryDto
- authStore.ts
- IndividualProfile
- ApprovalCenterPage.tsx
- UserFormLayer.tsx
- RoleAppService
- AuditLog
- ControllerBase
- ProfilePage.tsx
- SettingsUsersTab.tsx
- AuthService.Application.DTOs
- .CreateAsync
- .UpdateLeadAsync
- CorporateProfile
- ModuleRegistry.Options
- Interaction
- host/src/App.tsx
- compilerOptions
- AuthServiceClient
- RemoteAppPage.tsx
- AuthAppService
- AuditLogDto
- DashboardPage/DashboardPage.tsx
- Role
- LeadFieldConfigService
- RemoteAppAppService
- Skeleton/index.ts
- PermissionCatalogAppService
- lead_mf/src/api/hostBridge.ts
- RemoteAppsController
- useLeadStore
- AuthService
- ApprovalAppService
- FieldConfig
- useAuthStore
- StatusCode
- .Ok
- AuthService/Application/DTOs/ApprovalDtos.cs
- PermissionFeature
- DepositProduct
- LeadManagement.Api.Models.Dtos
- customer360_mf/src/api/hostBridge.ts
- system-audit-logs/pages/AuditLogsPage.tsx
- useLeadStore.ts
- .UpsertAsync
- CardsProduct
- AuditLog
- RemoteApp
- pages/DashboardPage.tsx
- User
- backend.Models
- Customer360.tsx
- types/api.ts
- ApprovalRequest
- LoanProduct
- CustomerProduct
- src/index.ts
- compilerOptions
- lead_mf/src/components/layout/MainLayout.tsx
- .WriteAsync
- UsersController
- ApplicationDbContext
- Lead
- AuthServiceClient
- MasterEntities.cs
- ViewLeadPage.tsx
- .List
- ApplyApprovedMutationRequest
- AuditLog
- AuthServiceClient
- ApprovalPendingDto
- .GetStatsAsync
- CreateLeadDto
- RemoteAppCapability
- customer360_mf/src/components/layout/MainLayout.tsx
- compilerOptions
- DashboardFilterDto
- scripts
- IAsyncAuthorizationFilter
- AuthDbContext
- OmniRemit
- .DeleteLead
- AuthDtos.cs
- RefreshTokenService
- Animation Standards Reference
- .Apply
- .Search
- SetPasswordInviteService
- UserPermissionOverride
- http
- ContactDetail
- WmProduct
- http
- http
- customerStore.ts
- Models.cs
- .Replace
- DynamicProfileSection.tsx
- RefreshToken
- SetPasswordInvite
- .SeedAsync
- .Replace
- .GetCorporateProfile
- Animation Audit Playbook
- LeadConsentDetail
- devDependencies
- AuditLogs.tsx
- devDependencies
- InitialCreate
- InitialCreate
- dependencies
- ui/package.json
- plugins
- useGoogleSignIn.ts
- .BuildModel
- SmtpOptions
- RemoteAppHealth
- PasswordPolicyOptions
- .DiscoverModules
- InitialCreate
- GoldProduct
- RemoteHealthOptions
- ApiResponseDto
- AppExceptionFilter
- SetPasswordInviteService.cs
- InitialCreate
- .Map
- InternalApiKeyFilter
- http
- AuthService.Options
- RefreshTokenCleanupService
- JwtOptions
- RateLimitOptions
- .DiscoverModules
- InternalApiKeyFilter
- RemoteHealthProber
- InternalApiKeyFilter
- customer360_mf/.oxlintrc.json
- AllInteractions.tsx
- RefreshTokenCleanupOptions
- RequiresCapabilityAttribute
- RequiresCapabilityAttribute
- ExceptionMiddleware
- Apple Design
- Branch
- index.d.ts
- FederationErrorBoundary
- components/Tabs/Tabs.tsx
- host/vercel.json
- federation-config/package.json
- GoogleAuthOptions
- MaskingRule
- State
- RemoteAppHealthProbeService
- index.js
- RsaKeyLoader
- TemporaryPasswordGenerator
- RsaKeyLoader
- .BuildModel
- .BuildModel
- .ProbeCoreAsync
- .SeedAsync
- compilerOptions
- .GetHealth
- ExceptionMiddleware
- JwtValidationOptions
- RsaKeyLoader
- useIdleTimeout.ts
- DatePicker.tsx
- AuthProvider
- .BuildTargetModel
- SelfOptions
- ModuleRegistry/Application/Exceptions/AppExceptions.cs
- RsaKeyLoader
- AuthService.Domain.Entities
- postbuild.js
- customer360_mf/vercel.json
- LeadRecordDto
- useCountUp.ts
- host/tsconfig.json
- lead_mf/vercel.json
- queryKeys.ts
- Workflow
- .Update
- Glossary
- Deploying OmniRemit
- Finding Animation Opportunities
- LeadFieldConfig
- CrmProxyService
- CheckerAssignment
- MutationResult
- Customer360DbContext
- ui/tsconfig.json
- PermissionFeatureCapability
- AuditDetailsDrawer.tsx
- compilerOptions
- The list
- RolePermission
- SecretProtector
- Design Engineering
- Component Building Principles
- Adding a New Remote App
- .SeedMasterData
- Performance: measured baseline, and the infrastructure work left to do
- formatDate.ts
- SalesExecutive
- The Animation Decision Framework
- clip-path for Animation
- Performance Rules
- Gesture and Drag Interactions
- SelfOptions
- CSS Transform Mastery
- The Sonner Principles (Building Loved Components)
- Spring Animations
- PagedResult
- Core Philosophy
- Debugging Animations
- React + Vite
- React + TypeScript + Vite
- .OnAuthorizationAsync
- packages/README.md
- css-modules.d.ts

## God Nodes (most connected - your core abstractions)
1. `IndividualProfile` - 69 edges
2. `useLeadStore` - 57 edges
3. `useAuthStore` - 56 edges
4. `CorporateProfile` - 47 edges
5. `Interaction` - 46 edges
6. `AuthDbContext` - 40 edges
7. `ApplicationDbContext` - 37 edges
8. `LeadRecordDto` - 37 edges
9. `ApprovalRequest` - 34 edges
10. `RemoteApp` - 33 edges

## Surprising Connections (you probably didn't know these)
- `handleApprove()` --calls--> `invalidate()`  [EXTRACTED]
  Frontend/apps/host/src/features/approvals/pages/ApprovalCenterPage.tsx → Frontend/apps/host/src/shared/stores/invalidationStore.ts
- `handleReject()` --calls--> `invalidate()`  [EXTRACTED]
  Frontend/apps/host/src/features/approvals/pages/ApprovalCenterPage.tsx → Frontend/apps/host/src/shared/stores/invalidationStore.ts
- `handleSubmit()` --calls--> `invalidate()`  [EXTRACTED]
  Frontend/apps/host/src/layout/SettingsDrawer/CheckerAssignmentFormLayer.tsx → Frontend/apps/host/src/shared/stores/invalidationStore.ts
- `confirmRemove()` --calls--> `invalidate()`  [EXTRACTED]
  Frontend/apps/host/src/layout/SettingsDrawer/SettingsCheckerAssignmentTab.tsx → Frontend/apps/host/src/shared/stores/invalidationStore.ts
- `LeadsByProductCard()` --calls--> `useLeadStore`  [EXTRACTED]
  Frontend/apps/lead_mf/src/components/dashboard/LeadsByProductCard.tsx → Frontend/apps/lead_mf/src/store/useLeadStore.ts

## Import Cycles
- None detected.

## Communities (230 total, 14 thin omitted)

### Community 0 - "KpiSummaryDto"
Cohesion: 0.05
Nodes (37): List, ConversionRateKpiDto, ConversionRate, IsAvailable, Source, InProgressKpiDto, InProgressLeads, IsAvailable (+29 more)

### Community 1 - "authStore.ts"
Cohesion: 0.04
Nodes (56): RFC-7807, App(), env, AuthBroadcast, AuthState, AuthStatus, registerSessionCleanup(), sessionCleanupHandlers (+48 more)

### Community 2 - "IndividualProfile"
Cohesion: 0.03
Nodes (68): IndividualProfile, AnnualIncome, BirthCertificate, BirthDate, Branch, BranchCode, BumiStatus, CampaignCode (+60 more)

### Community 3 - "ApprovalCenterPage.tsx"
Cohesion: 0.05
Nodes (54): ApprovalCenterPage, MyRequestsPage, ApprovalAction, ApprovalRequestDetailDto, ApprovalRequestListItemDto, approvalsApi, ApprovalStatus, ApprovalSummaryDto (+46 more)

### Community 4 - "UserFormLayer.tsx"
Cohesion: 0.07
Nodes (49): RFC-5322, ApprovalPendingDto, isApprovalPending(), asPendingApprovalConflict(), remoteAppsApi, RoleFormLayer(), RoleFormLayerProps, STEP_META (+41 more)

### Community 5 - "RoleAppService"
Cohesion: 0.14
Nodes (26): RoleDetailDto, RoleListItemDto, RolePermissionGrantDto, RoleUserDto, RoleUsersDto, UpsertRoleRequest, DateTimeOffset, Guid (+18 more)

### Community 6 - "AuditLog"
Cohesion: 0.06
Nodes (44): AuditLogDto, AuditLogSummaryDto, RecordAuditLogRequest, DateTimeOffset, Guid, AuditLogAppService, AuditLogSummaryDto, CancellationToken (+36 more)

### Community 7 - "ControllerBase"
Cohesion: 0.12
Nodes (28): ActionResult, HttpGet, List, RequiresCapability, Task, BranchesController, ProductsController, ReferenceDataController (+20 more)

### Community 8 - "ProfilePage.tsx"
Cohesion: 0.06
Nodes (35): ProfilePage, IdleWarningModalProps, RequirePasswordChange(), ChangePasswordForm(), ChangePasswordFormProps, DrawerTab, formatDateTime(), getUserInitials() (+27 more)

### Community 9 - "SettingsUsersTab.tsx"
Cohesion: 0.09
Nodes (34): AssignableModuleDto, CheckerAssignmentDto, checkerAssignmentsApi, UpsertCheckerAssignmentRequest, formatWhen(), PendingApprovalDialog(), PendingApprovalDialogProps, PendingApprovalConflict (+26 more)

### Community 10 - "AuthService.Application.DTOs"
Cohesion: 0.32
Nodes (5): AuthService.Infrastructure.Seed, AuthService.Controllers, AuthService.Application.DTOs, AuthService.Infrastructure.Security, AuthService.Application.Services

### Community 11 - ".CreateAsync"
Cohesion: 0.16
Nodes (29): CreateUserRequest, CreateUserResponse, CreateUserWithOverridesRequest, PermissionOverrideDto, UpdateUserPermissionOverridesRequest, UpdateUserRequest, UpdateUserStatusRequest, UpdateUserWithOverridesRequest (+21 more)

### Community 12 - ".UpdateLeadAsync"
Cohesion: 0.18
Nodes (13): HttpPost, IActionResult, List, Task, InternalApprovalsController, DeleteLeadDto, DeleteReason, UpdateLeadDto (+5 more)

### Community 13 - "CorporateProfile"
Cohesion: 0.04
Nodes (46): CorporateProfile, AnnualIncome, Brn, Brn2, BusinessRegDate, CampaignEligibleA, CampaignEligibleB, CifNumber (+38 more)

### Community 14 - "ModuleRegistry.Options"
Cohesion: 0.06
Nodes (25): InternalApprovalsController, JwtClaimTypes, ModuleRegistryDbSeeder, AuthIntegrationOptions, BaseUrl, InternalApiKey, CorsOptions, AllowedOrigins (+17 more)

### Community 15 - "Interaction"
Cohesion: 0.04
Nodes (45): Interaction, ActionDetails, ActionSummary, AmountInvolved, BnmName, BranchHqName, BranchName, BusinessDays (+37 more)

### Community 16 - "host/src/App.tsx"
Cohesion: 0.08
Nodes (31): { Component: DashboardPage, preload: preloadDashboard }, FEATURE_KEYS, LoginRoute(), SettingsDeepLink(), RequireAuth(), AppShell(), AppShellProps, { Component: SettingsDrawer, preload: preloadSettingsDrawer } (+23 more)

### Community 17 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, allowJs, checkJs, isolatedModules, jsx, lib, module (+15 more)

### Community 18 - "AuthServiceClient"
Cohesion: 0.10
Nodes (32): RemoteCapability, CancellationToken, Guid, HttpClient, IHttpContextAccessor, ILogger, IOptions, IReadOnlyList (+24 more)

### Community 19 - "RemoteAppPage.tsx"
Cohesion: 0.07
Nodes (31): AuthenticatedShell(), MaintenancePage, NotFoundPage, RemoteAppPage, dashboardApi, DashboardStatsDto, RoleDistributionDto, ServiceActivityDto (+23 more)

### Community 20 - "AuthAppService"
Cohesion: 0.11
Nodes (27): ChangePasswordResponse, GoneAppException, AccountInactiveException, AuthAppService, AuthResult, InvalidCredentialsException, InvalidRefreshTokenException, PasswordChangeRejectedException (+19 more)

### Community 21 - "AuditLogDto"
Cohesion: 0.08
Nodes (30): ActionResult, HttpGet, RequiresCapability, Task, AuditLogsController, AuditLogDto, ActionType, Description (+22 more)

### Community 22 - "DashboardPage/DashboardPage.tsx"
Cohesion: 0.09
Nodes (26): SetPasswordPage, SidebarProps, APP_COLORS, DashboardPage(), formatActionText(), formatEventTime(), getUserInitials(), ROLE_COLORS (+18 more)

### Community 23 - "Role"
Cohesion: 0.14
Nodes (13): Role, CreatedAt, Description, Id, IsAdministrator, IsSystemRole, Name, RolePermissions (+5 more)

### Community 24 - "LeadFieldConfigService"
Cohesion: 0.26
Nodes (7): CancellationToken, Guid, LeadFieldConfig, List, Product, Task, LeadFieldConfigService

### Community 25 - "RemoteAppAppService"
Cohesion: 0.15
Nodes (19): Guid, CapabilityDto, RemoteAppDto, ValidationAppException, CancellationToken, Guid, HealthEntryDto, ILogger (+11 more)

### Community 26 - "Skeleton/index.ts"
Cohesion: 0.08
Nodes (21): RequireCapability(), RequireCapabilityProps, RoleUserDto, UsersUsingRolePanelProps, RouteFallback(), SkeletonAppCard(), SkeletonAuditRow(), SkeletonAvatar() (+13 more)

### Community 27 - "PermissionCatalogAppService"
Cohesion: 0.12
Nodes (26): CapabilityDto, DeactivatePermissionFeatureRequest, PermissionFeatureDto, ResyncPermissionFeaturesRequest, UpsertCapabilityRequest, UpsertModuleRequest, UpsertPermissionFeatureRequest, Guid (+18 more)

### Community 28 - "lead_mf/src/api/hostBridge.ts"
Cohesion: 0.11
Nodes (30): fetchWithAuth(), getAuthHeaders(), canCreateLead(), canManageFieldSettings(), canViewAuditLogs(), canViewDashboard(), canViewLeads(), ensureFreshAccessToken() (+22 more)

### Community 29 - "RemoteAppsController"
Cohesion: 0.16
Nodes (21): DateTimeOffset, HealthEntryDto, SidebarAppDto, ActionResult, CancellationToken, Guid, HttpDelete, HttpGet (+13 more)

### Community 30 - "useLeadStore"
Cohesion: 0.20
Nodes (24): SearchableDropdown(), CustomerInformationSection(), CustomerInformationSectionProps, DeclarationConsentSection(), DeclarationConsentSectionProps, EditLeadDrawer(), LeadFormContainer(), LeadFormContainerProps (+16 more)

### Community 31 - "AuthService"
Cohesion: 0.05
Nodes (38): AuthService, DotNetEnv (3.2.0), Microsoft.AspNetCore.Authentication.JwtBearer (10.0.0), Microsoft.AspNetCore.OpenApi (10.0.9), Microsoft.EntityFrameworkCore.Design (10.0.0), Microsoft.EntityFrameworkCore.SqlServer (10.0.0), Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore (10.0.8), Microsoft.OpenApi (2.12.0) (+30 more)

### Community 32 - "ApprovalAppService"
Cohesion: 0.22
Nodes (13): ApprovalRequestDetailDto, ApprovalAppService, RemoteReplayGuard, Fired, ApprovalSummaryDto, CancellationToken, DateTimeOffset, Guid (+5 more)

### Community 33 - "FieldConfig"
Cohesion: 0.10
Nodes (27): InternalApprovalsController, HttpPost, IActionResult, List, Task, FieldConfigService, FieldConfig, Guid (+19 more)

### Community 34 - "useAuthStore"
Cohesion: 0.13
Nodes (23): AppRoutes(), useSilentRefresh(), useAuthStore, ApprovalsMenu(), formatRelativeTime(), formatFullTime(), formatRelativeTime(), readLastSeen() (+15 more)

### Community 35 - "StatusCode"
Cohesion: 0.40
Nodes (7): ProductController, HttpGet, IActionResult, Task, StatusCode, CancellationToken, Task

### Community 36 - ".Ok"
Cohesion: 0.19
Nodes (17): AllowAnonymous, AllowWhenPasswordChangeRequired, Authorize, AuthController, ActionResult, CancellationToken, DateTimeOffset, HttpGet (+9 more)

### Community 37 - "AuthService/Application/DTOs/ApprovalDtos.cs"
Cohesion: 0.12
Nodes (18): ApplyApprovedMutationRequest, ApprovalActionKeys, ApprovalModuleKeys, ApprovalRequestListItemDto, ApprovalStatus, ApprovalSummaryDto, PendingApprovalConflictDto, RejectApprovalRequest (+10 more)

### Community 38 - "PermissionFeature"
Cohesion: 0.09
Nodes (21): PermissionFeature, Capabilities, Children, CreatedAt, DisplayName, Id, IsActive, Key (+13 more)

### Community 39 - "DepositProduct"
Cohesion: 0.06
Nodes (31): DepositProduct, AccountNumber, AccountOpeningDate, AccountPurposes, Balances, BlockingReasons, BranchAccount, CerdFromCertNum (+23 more)

### Community 40 - "LeadManagement.Api.Models.Dtos"
Cohesion: 0.12
Nodes (14): Task, LeadDbSeeder, JwtClaimTypes, CorsOptions, AllowedOrigins, LeadManagement.Api.Infrastructure, LeadManagement.Api.Data, LeadManagement.Api.Models.Dtos (+6 more)

### Community 41 - "customer360_mf/src/api/hostBridge.ts"
Cohesion: 0.11
Nodes (28): C360_FEATURE_KEY, C360_SUBMODULE_AUDIT, C360_SUBMODULE_CONTACT, C360_SUBMODULE_FIELD_SETTINGS, C360_SUBMODULE_INTERACTIONS, C360_SUBMODULE_PRODUCTS, C360_SUBMODULE_PROFILE, canManageFieldSettings() (+20 more)

### Community 42 - "system-audit-logs/pages/AuditLogsPage.tsx"
Cohesion: 0.09
Nodes (23): AuditLogsPage, AuditLogSummaryDto, ACTION_LABELS, AuditLogsPage(), load(), computeRangeWithCustom(), DATE_RANGES, DateFilterMode (+15 more)

### Community 43 - "useLeadStore.ts"
Cohesion: 0.06
Nodes (47): apiClient, ApiResponse, ApprovalPendingDto, BranchDistribution, DashboardFilterParams, DropdownOption, isApprovalPending(), KpiSparklinePoint (+39 more)

### Community 44 - ".UpsertAsync"
Cohesion: 0.15
Nodes (21): AssignableModuleDto, CheckerAssignmentDto, NotFoundAppException, CheckerAssignmentAppService, AssignableModuleDto, CancellationToken, CheckerAssignmentDto, Guid (+13 more)

### Community 45 - "CardsProduct"
Cohesion: 0.07
Nodes (29): CardsProduct, AccountNo, AcctBlk, AcctBrch, Brn, CardBlk, CardBlkDate, CardExpiredDate (+21 more)

### Community 46 - "AuditLog"
Cohesion: 0.07
Nodes (29): AuditController, AuditLogInput, Action, Customer, CustomerId, CustomerType, Description, Field (+21 more)

### Community 47 - "RemoteApp"
Cohesion: 0.07
Nodes (27): DateTimeOffset, Guid, ICollection, RemoteApp, Capabilities, ContainerName, CreatedAt, CreatedBy (+19 more)

### Community 48 - "pages/DashboardPage.tsx"
Cohesion: 0.13
Nodes (14): formatKpiValue(), ICON_WRAP_STYLES, KPI_CONFIG, KpiCardSection(), BRANCH_COLORS, LeadsByBranchCard(), LeadsByProductCard(), GRANULARITY_LABELS (+6 more)

### Community 49 - "User"
Cohesion: 0.07
Nodes (26): User, AuthProvider, CreatedAt, CreatedBy, Email, Id, IsDeleted, LastLoginAt (+18 more)

### Community 50 - "backend.Models"
Cohesion: 0.20
Nodes (8): JwtClaimTypes, backend.Middleware, backend.Infrastructure.Security, backend.Controllers, backend.Infrastructure, backend.Options, backend.Data, backend.Models

### Community 51 - "Customer360.tsx"
Cohesion: 0.15
Nodes (13): CompanyOverview(), groupBySection(), IndividualDetails(), SUBTAB_SECTIONS, DEFAULT_CORPORATE_FIELD_CONFIGS, DEFAULT_INDIVIDUAL_FIELD_CONFIGS, RevealAuditContext, useFieldReveal() (+5 more)

### Community 52 - "types/api.ts"
Cohesion: 0.14
Nodes (22): FieldSettings(), MASKING_RULE_LABELS, ApiEnvelope, PaginatedEnvelope, ProductStoreState, SelectedProductDetails, ApprovalPendingDto, AuditLog (+14 more)

### Community 53 - "ApprovalRequest"
Cohesion: 0.08
Nodes (24): ApprovalRequest, Action, CallbackUrl, CorrelationId, DecidedAt, EntityId, EntityKey, EntityLabel (+16 more)

### Community 54 - "LoanProduct"
Cohesion: 0.08
Nodes (25): LoanProduct, AccountNo, CurrentRate, CustId, DisbursedDate, FinancingAmount, FinancingStatus, IlomSeq (+17 more)

### Community 55 - "CustomerProduct"
Cohesion: 0.06
Nodes (34): DualNamingConverter, DualNamingConverterFactory, Dictionary, CustomerProduct, AccountNumber, AccountOpeningDate, Balances, CampaignCode (+26 more)

### Community 56 - "src/index.ts"
Cohesion: 0.07
Nodes (50): DataTable(), DataTableEmpty(), DataTableEmptyProps, DataTableProps, EmptyState(), EmptyStateProps, Pagination(), PaginationProps (+42 more)

### Community 57 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, noEmit, tsBuildInfoFile, types, verbatimModuleSyntax (+5 more)

### Community 58 - "lead_mf/src/components/layout/MainLayout.tsx"
Cohesion: 0.12
Nodes (10): App(), ErrorBoundary, Props, State, ToastNotification(), MainLayout(), rootElement, CreateLeadPage() (+2 more)

### Community 59 - ".WriteAsync"
Cohesion: 0.20
Nodes (15): ConflictAppException, PendingApprovalConflictException, Pending, ApprovalGatingService, ApprovalPendingDto, CancellationToken, Guid, IReadOnlyList (+7 more)

### Community 60 - "UsersController"
Cohesion: 0.27
Nodes (13): UsersController, ActionResult, CancellationToken, Guid, HttpDelete, HttpGet, HttpPatch, HttpPost (+5 more)

### Community 61 - "ApplicationDbContext"
Cohesion: 0.13
Nodes (15): DbSet, ApplicationDbContext, AuditLogs, Branches, EntityTypes, LeadConsentDetails, LeadFieldConfigs, LeadHomeFinancingDetails (+7 more)

### Community 62 - "Lead"
Cohesion: 0.09
Nodes (23): Lead, AppliedAmount, BranchId, ConsentDetail, CreatedAt, CustomerName, Email, EmployerName (+15 more)

### Community 63 - "AuthServiceClient"
Cohesion: 0.15
Nodes (16): ApprovalServiceUnavailableException, AuthServiceClient, GatedResponse, RecordAuditLogRequest, SubmitInternalApprovalRequest, CancellationToken, Guid, HttpClient (+8 more)

### Community 64 - "MasterEntities.cs"
Cohesion: 0.15
Nodes (15): Guid, EntityTypeLookup, Id, Name, Product, Code, Id, IsActive (+7 more)

### Community 65 - "ViewLeadPage.tsx"
Cohesion: 0.15
Nodes (22): canDeleteLead(), canEditLead(), DeleteLeadDrawer(), EditReasonDrawer(), PREDEFINED_REASONS, formatConsent(), formatRinggit(), formatVal() (+14 more)

### Community 66 - ".List"
Cohesion: 0.37
Nodes (9): ApprovalsController, ActionResult, CancellationToken, DateTimeOffset, Guid, HttpGet, HttpPost, RequirePermission (+1 more)

### Community 67 - "ApplyApprovedMutationRequest"
Cohesion: 0.11
Nodes (19): ApplyApprovedMutationRequest, ActingUserId, ActingUserName, Action, CorrelationId, EntityId, EntityType, Module (+11 more)

### Community 68 - "AuditLog"
Cohesion: 0.12
Nodes (17): DateTime, Guid, AuditLog, ActionType, Description, EntityId, EntityType, Id (+9 more)

### Community 69 - "AuthServiceClient"
Cohesion: 0.16
Nodes (15): ApprovalServiceUnavailableException, CancellationToken, Guid, HttpClient, IHttpContextAccessor, ILogger, IOptions, Task (+7 more)

### Community 70 - "ApprovalPendingDto"
Cohesion: 0.11
Nodes (19): Guid, ApplyApprovedMutationRequest, ActingUserId, ActingUserName, Action, CorrelationId, EntityId, EntityType (+11 more)

### Community 71 - ".GetStatsAsync"
Cohesion: 0.15
Nodes (16): DashboardStatsDto, RoleDistributionDto, ServiceActivityDto, TrendDto, IReadOnlyList, DashboardAppService, CancellationToken, DashboardStatsDto (+8 more)

### Community 72 - "CreateLeadDto"
Cohesion: 0.10
Nodes (20): CreateLeadDto, AgreedToPrivacyPolicy, AppliedAmount, CompanyName, CustomerName, DateOfIncorporation, Email, EmployerName (+12 more)

### Community 73 - "RemoteAppCapability"
Cohesion: 0.11
Nodes (17): Guid, RemoteAppCapability, DisplayName, Id, Key, ModuleDisplayName, ModuleKey, RemoteApp (+9 more)

### Community 74 - "customer360_mf/src/components/layout/MainLayout.tsx"
Cohesion: 0.19
Nodes (12): App(), LayoutProps, MainLayout(), detectProductType(), ProductDetailsModal(), rootElement, AllProducts(), useCustomerStore (+4 more)

### Community 75 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 76 - "DashboardFilterDto"
Cohesion: 0.13
Nodes (21): DateTime, BranchDistributionDto, BranchName, Count, DashboardFilterDto, Branch, EndDate, Granularity (+13 more)

### Community 77 - "scripts"
Cohesion: 0.10
Nodes (19): engines, node, pnpm, name, packageManager, private, scripts, build (+11 more)

### Community 78 - "IAsyncAuthorizationFilter"
Cohesion: 0.14
Nodes (10): Attribute, AllowWhenPasswordChangeRequiredAttribute, MustChangePasswordFilter, AuthorizationFilterContext, Task, RequirePermissionAttribute, AuthorizationFilterContext, Task (+2 more)

### Community 79 - "AuthDbContext"
Cohesion: 0.12
Nodes (16): AuthDbContext, ApprovalRequests, AuditLogs, CheckerAssignments, PermissionFeatureCapabilities, PermissionFeatures, RefreshTokens, RolePermissions (+8 more)

### Community 80 - "OmniRemit"
Cohesion: 0.06
Nodes (29): Contract for future remote apps, First-time setup, Generating the RS256 key pair, Known limitations / not yet built, OmniRemit, Prerequisites, Repo layout, Running everything (+21 more)

### Community 81 - ".DeleteLead"
Cohesion: 0.28
Nodes (9): ActionResult, Guid, HttpDelete, HttpGet, HttpPost, HttpPut, RequiresCapability, Task (+1 more)

### Community 82 - "AuthDtos.cs"
Cohesion: 0.18
Nodes (13): ChangePasswordRequest, CurrentUserDto, GoogleLoginRequest, LoginRequest, LoginResponse, PasswordPolicyDto, RefreshResponse, SetPasswordRequest (+5 more)

### Community 83 - "RefreshTokenService"
Cohesion: 0.28
Nodes (9): IssuedRefreshToken, RefreshTokenService, AuthDbContext, CancellationToken, DateTimeOffset, Guid, IOptions, Task (+1 more)

### Community 84 - "Animation Standards Reference"
Cohesion: 0.07
Nodes (25): Aggressive Escalation Triggers, Guidelines, Operating Posture, Part 1 — Findings table (REQUIRED), Part 2 — Verdict (REQUIRED), Remedial Preference Hierarchy, Required Output Format, Reviewing Animations (+17 more)

### Community 85 - ".Apply"
Cohesion: 0.15
Nodes (13): Guid, ApplyApprovedMutationRequest, ApprovalPendingDto, MutationResult, IReadOnlyList, CreateRemoteAppRequest, PagedResult, UpdateRemoteAppRequest (+5 more)

### Community 86 - ".Search"
Cohesion: 0.14
Nodes (13): SearchResultDto, SearchAppService, CancellationToken, IReadOnlyList, IReadOnlySet, SearchResultDto, Task, SearchController (+5 more)

### Community 87 - "SetPasswordInviteService"
Cohesion: 0.20
Nodes (10): SetPasswordInviteService, IsEnabled, CancellationToken, Guid, ILogger, IOptions, Task, Html (+2 more)

### Community 88 - "UserPermissionOverride"
Cohesion: 0.12
Nodes (15): UserPermissionOverride, Capability, CreatedAt, CreatedBy, Effect, Feature, FeatureId, Id (+7 more)

### Community 89 - "http"
Cohesion: 0.13
Nodes (15): ASPNETCORE_ENVIRONMENT, applicationUrl, commandName, dotnetRunMessages, environmentVariables, launchBrowser, applicationUrl, commandName (+7 more)

### Community 90 - "ContactDetail"
Cohesion: 0.12
Nodes (15): ContactController, HttpGet, IActionResult, Task, ContactDetail, ContactNumber, FixedAddress, MailingAddress (+7 more)

### Community 91 - "WmProduct"
Cohesion: 0.12
Nodes (16): WmProduct, AutoRenewal, BasicContributionAmount, CertificateStatus, CommencementDate, CustomerName, ExpiryDate, PaymentMode (+8 more)

### Community 92 - "http"
Cohesion: 0.13
Nodes (15): ASPNETCORE_ENVIRONMENT, applicationUrl, commandName, dotnetRunMessages, environmentVariables, launchBrowser, applicationUrl, commandName (+7 more)

### Community 93 - "http"
Cohesion: 0.13
Nodes (15): ASPNETCORE_ENVIRONMENT, applicationUrl, commandName, dotnetRunMessages, environmentVariables, launchBrowser, applicationUrl, commandName (+7 more)

### Community 94 - "customerStore.ts"
Cohesion: 0.23
Nodes (14): CompanyOverviewProps, CustomerHeader(), CustomerHeaderProps, IndividualDetailsProps, clearSavedCustomer(), CustomerStoreState, getSessionStorage(), readSavedCustomer() (+6 more)

### Community 95 - "Models.cs"
Cohesion: 0.13
Nodes (14): UnitTrustProduct, CustomerName, FundName, InvestmentAccountNo, Nric, PositionDate, UnitHoldings, WillWritingProduct (+6 more)

### Community 96 - ".Replace"
Cohesion: 0.22
Nodes (10): ActionResult, CancellationToken, Guid, HttpGet, HttpPut, IActionResult, List, RequiresCapability (+2 more)

### Community 97 - "DynamicProfileSection.tsx"
Cohesion: 0.23
Nodes (12): DynamicProfileSection(), DynamicProfileSectionProps, FIELD_ICONS, resolveRawValue(), SECTION_ICONS, SectionContainer(), SectionContainerProps, CustomerProfile (+4 more)

### Community 98 - "RefreshToken"
Cohesion: 0.14
Nodes (13): RefreshToken, AbsoluteExpiresAt, CreatedAt, CreatedByIp, ExpiresAt, Id, IsActive, ReplacedByTokenId (+5 more)

### Community 99 - "SetPasswordInvite"
Cohesion: 0.14
Nodes (13): SetPasswordInvite, CreatedAt, CreatedBy, ExpiresAt, Id, IsRedeemable, RevokedAt, TokenHash (+5 more)

### Community 100 - ".SeedAsync"
Cohesion: 0.40
Nodes (8): AuthDbSeeder, HostFeatureKeys, AuthDbContext, CancellationToken, Dictionary, ILogger, Role, Task

### Community 101 - ".Replace"
Cohesion: 0.23
Nodes (8): FieldConfigController, Guid, HttpGet, HttpPut, IActionResult, List, RequiresCapability, Task

### Community 102 - ".GetCorporateProfile"
Cohesion: 0.21
Nodes (11): LookupOption, Label, Value, ProfileController, HttpGet, IActionResult, IConfiguration, List (+3 more)

### Community 103 - "Animation Audit Playbook"
Cohesion: 0.09
Nodes (21): 1. Purpose & frequency, 2. Easing & duration, 3. Physicality & origin, 4. Interruptibility, 5. Performance, 6. Accessibility, 7. Cohesion & tokens, 8. Missed opportunities (+13 more)

### Community 104 - "LeadConsentDetail"
Cohesion: 0.10
Nodes (22): DateTime, Guid, LeadConsentDetail, AgreedToPrivacyPolicy, ConsentedAt, Id, Lead, LeadId (+14 more)

### Community 105 - "devDependencies"
Cohesion: 0.04
Nodes (45): dependencies, lucide-react, @omniremit/federation-config, @omniremit/ui, react, react-dom, zustand, devDependencies (+37 more)

### Community 106 - "AuditLogs.tsx"
Cohesion: 0.22
Nodes (11): AuditLogs(), formatAuditTimestamp(), getActionBadge(), getActorInitial(), ApiError, buildNotFoundMessage(), buildValidationMessage(), ClassifiableError (+3 more)

### Community 107 - "devDependencies"
Cohesion: 0.04
Nodes (47): dependencies, lucide-react, @omniremit/federation-config, @omniremit/ui, react, react-dom, recharts, zustand (+39 more)

### Community 108 - "InitialCreate"
Cohesion: 0.18
Nodes (8): DateTime, Guid, MigrationBuilder, DateTime, Guid, ModelBuilder, InitialCreate, LeadManagement.Api.Migrations

### Community 109 - "InitialCreate"
Cohesion: 0.18
Nodes (8): DateTimeOffset, Guid, MigrationBuilder, DateTimeOffset, Guid, ModelBuilder, InitialCreate, ModuleRegistry.Infrastructure.Migrations

### Community 110 - "dependencies"
Cohesion: 0.04
Nodes (44): dependencies, @module-federation/runtime, @omniremit/federation-config, @omniremit/ui, react, react-dom, react-router-dom, @tanstack/react-query (+36 more)

### Community 111 - "ui/package.json"
Cohesion: 0.09
Nodes (21): devDependencies, @types/react, @types/react-dom, typescript, exports, ./tokens.css, react, react-dom (+13 more)

### Community 112 - "plugins"
Cohesion: 0.20
Nodes (9): oxc, react, warn, plugins, rules, react/only-export-components, react/rules-of-hooks, $schema (+1 more)

### Community 113 - "useGoogleSignIn.ts"
Cohesion: 0.19
Nodes (11): GoogleSignInButton(), GoogleSignInButtonProps, GoogleButtonOptions, GoogleIdConfig, GoogleSignInState, GoogleSignInStatus, loadGis(), useGoogleSignIn() (+3 more)

### Community 114 - ".BuildModel"
Cohesion: 0.17
Nodes (8): AuthDbContextModelSnapshot, DateTimeOffset, Guid, ModelBuilder, Customer360DbContextModelSnapshot, Guid, ModelBuilder, ModelSnapshot

### Community 115 - "SmtpOptions"
Cohesion: 0.17
Nodes (11): SmtpOptions, AppBaseUrl, FromAddress, FromName, Host, InviteValidHours, IsConfigured, Password (+3 more)

### Community 116 - "RemoteAppHealth"
Cohesion: 0.17
Nodes (10): RemoteAppHealth, Healthy, Unknown, Unreachable, CancellationToken, HttpClient, ILogger, Task (+2 more)

### Community 117 - "PasswordPolicyOptions"
Cohesion: 0.20
Nodes (8): PasswordPolicyOptions, MaximumLength, MinimumLength, RejectSameAsCurrent, RequireDigit, RequireLowercase, RequireNonAlphanumeric, RequireUppercase

### Community 118 - ".DiscoverModules"
Cohesion: 0.24
Nodes (9): DiscoveredCapability, DiscoveredModule, PermissionsController, ActionResult, HttpGet, IReadOnlyList, List, DiscoveredCapability (+1 more)

### Community 119 - "InitialCreate"
Cohesion: 0.22
Nodes (6): Guid, MigrationBuilder, InitialCreate, Guid, ModelBuilder, backend.Migrations

### Community 120 - "GoldProduct"
Cohesion: 0.18
Nodes (11): GoldProduct, AccountType, BankBuySell, CreatedDate, CustomerName, GoldAccountNo, PositionDate, PrimaryIdNo (+3 more)

### Community 121 - "RemoteHealthOptions"
Cohesion: 0.18
Nodes (10): TimeSpan, RemoteHealthOptions, ConfirmedFailures, Enabled, Interval, OnDemandMaximumAge, ProbeTimeout, StartupDelay (+2 more)

### Community 122 - "ApiResponseDto"
Cohesion: 0.31
Nodes (12): ActionResult, HttpGet, List, RequiresCapability, Task, DashboardController, Dictionary, ApiResponseDto (+4 more)

### Community 123 - "AppExceptionFilter"
Cohesion: 0.22
Nodes (7): AppExceptionFilter, ExceptionContext, ILogger, ExceptionContext, AppExceptionFilter, DbUpdateException, IExceptionFilter

### Community 124 - "SetPasswordInviteService.cs"
Cohesion: 0.21
Nodes (9): EmailSender, IsEnabled, IEmailSender, IsEnabled, CancellationToken, ILogger, IOptions, Task (+1 more)

### Community 125 - "InitialCreate"
Cohesion: 0.24
Nodes (6): DateTimeOffset, Guid, MigrationBuilder, InitialCreate, AuthService.Infrastructure.Migrations, Migration

### Community 126 - ".Map"
Cohesion: 0.29
Nodes (5): CrmMapper, JsonElementExtensions, List, ColumnAttribute, JsonElement

### Community 127 - "InternalApiKeyFilter"
Cohesion: 0.22
Nodes (6): InternalApiKeyFilter, AuthorizationFilterContext, IOptions, Task, InternalApiOptions, ApiKey

### Community 128 - "http"
Cohesion: 0.20
Nodes (9): ASPNETCORE_ENVIRONMENT, applicationUrl, commandName, dotnetRunMessages, environmentVariables, launchBrowser, profiles, http (+1 more)

### Community 129 - "AuthService.Options"
Cohesion: 0.08
Nodes (15): InternalApiKeyFilter, AuthorizationFilterContext, IOptions, Task, AccessTokenResult, DateTimeOffset, AuthCookieOptions, RefreshCookieDomain (+7 more)

### Community 130 - "RefreshTokenCleanupService"
Cohesion: 0.31
Nodes (7): RefreshTokenCleanupService, AuthDbContext, CancellationToken, ILogger, IOptions, IServiceProvider, Task

### Community 131 - "JwtOptions"
Cohesion: 0.22
Nodes (8): JwtOptions, AbsoluteSessionHours, AccessTokenMinutes, Audience, Issuer, RefreshTokenDays, SigningKeyPrivate, SigningKeyPublic

### Community 132 - "RateLimitOptions"
Cohesion: 0.22
Nodes (8): RateLimitOptions, AuthPermitLimit, AuthQueueLimit, AuthWindowSeconds, Enabled, SensitivePermitLimit, SensitiveWindowSeconds, RateLimitPolicies

### Community 133 - ".DiscoverModules"
Cohesion: 0.31
Nodes (7): ActionResult, HttpGet, IReadOnlyList, List, DiscoveredCapability, DiscoveredModule, PermissionsController

### Community 134 - "InternalApiKeyFilter"
Cohesion: 0.25
Nodes (6): AuthorizationFilterContext, IOptions, Task, InternalApiKeyFilter, InternalApiOptions, ApiKey

### Community 135 - "RemoteHealthProber"
Cohesion: 0.22
Nodes (9): DateTimeOffset, Guid, ILogger, IOptions, IServiceProvider, SemaphoreSlim, RemoteHealthProber, HasUnsettledApps (+1 more)

### Community 136 - "InternalApiKeyFilter"
Cohesion: 0.25
Nodes (6): AuthorizationFilterContext, IOptions, Task, InternalApiKeyFilter, InternalApiOptions, ApiKey

### Community 137 - "customer360_mf/.oxlintrc.json"
Cohesion: 0.22
Nodes (8): oxc, react, warn, plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 138 - "AllInteractions.tsx"
Cohesion: 0.44
Nodes (6): CaseDetailsModal(), AllInteractions(), getStatusBadge(), InteractionStoreState, useInteractionStore, Interaction

### Community 139 - "RefreshTokenCleanupOptions"
Cohesion: 0.25
Nodes (7): RefreshTokenCleanupOptions, BatchSize, Enabled, Interval, Retention, StartupDelay, TimeSpan

### Community 140 - "RequiresCapabilityAttribute"
Cohesion: 0.25
Nodes (6): RequiresCapabilityAttribute, Capability, Module, RequiredPermission, AuthorizationFilterContext, Task

### Community 141 - "RequiresCapabilityAttribute"
Cohesion: 0.25
Nodes (6): AuthorizationFilterContext, Task, RequiresCapabilityAttribute, Capability, Module, RequiredPermission

### Community 142 - "ExceptionMiddleware"
Cohesion: 0.36
Nodes (6): Exception, HttpContext, ILogger, RequestDelegate, Task, ExceptionMiddleware

### Community 143 - "Apple Design"
Cohesion: 0.10
Nodes (20): 10. Gesture design details (the "feel" checklist), 11. Frame-level smoothness, 12. Materials & depth — translucency conveys hierarchy, 13. Multimodal feedback — motion + sound + haptics, 14. Reduced motion & accessibility, 15. Typography — optical sizing, tracking, leading, 16. Design foundations — the eight principles, 17. Process (+12 more)

### Community 144 - "Branch"
Cohesion: 0.25
Nodes (8): State, Branch, Code, Id, IsActive, Name, State, StateId

### Community 145 - "index.d.ts"
Cohesion: 0.25
Nodes (3): HostFederationOptions, RemoteFederationOptions, SharedDependencyConfig

### Community 147 - "components/Tabs/Tabs.tsx"
Cohesion: 0.29
Nodes (6): TabItem, TabPanelProps, Tabs(), focusAndSelect(), handleKeyDown(), TabsProps

### Community 148 - "host/vercel.json"
Cohesion: 0.25
Nodes (7): buildCommand, framework, headers, installCommand, outputDirectory, rewrites, $schema

### Community 149 - "federation-config/package.json"
Cohesion: 0.25
Nodes (7): exports, main, name, private, type, types, version

### Community 150 - "GoogleAuthOptions"
Cohesion: 0.29
Nodes (6): GoogleAuthOptions, AllowedDomains, AllowedDomainsList, ClientId, IsConfigured, IReadOnlyList

### Community 151 - "MaskingRule"
Cohesion: 0.29
Nodes (6): MaskingRule, FullMask, HideFirstShowLast, HideLastShowFirst, HideMiddleShowFirstAndLast, None

### Community 152 - "State"
Cohesion: 0.29
Nodes (7): Branch, ICollection, State, Branches, Code, Id, Name

### Community 153 - "RemoteAppHealthProbeService"
Cohesion: 0.29
Nodes (6): CancellationToken, ILogger, IOptions, Task, RemoteAppHealthProbeService, BackgroundService

### Community 154 - "index.js"
Cohesion: 0.38
Nodes (6): BASELINE_SHARED, hostFederationConfig(), pickShared(), REMOTE_ENTRY_MODULE, remoteFederationConfig(), sharedDependencies

### Community 157 - "RsaKeyLoader"
Cohesion: 0.40
Nodes (3): RSA, RsaKeyLoader, Customer360Service.Infrastructure

### Community 158 - ".BuildModel"
Cohesion: 0.33
Nodes (4): DateTime, Guid, ModelBuilder, ApplicationDbContextModelSnapshot

### Community 159 - ".BuildModel"
Cohesion: 0.33
Nodes (4): DateTimeOffset, Guid, ModelBuilder, ModuleRegistryDbContextModelSnapshot

### Community 160 - ".ProbeCoreAsync"
Cohesion: 0.60
Nodes (3): CancellationToken, Task, TimeSpan

### Community 161 - ".SeedAsync"
Cohesion: 0.33
Nodes (5): AuthServiceClient, CancellationToken, ILogger, ModuleRegistryDbContext, Task

### Community 162 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 163 - ".GetHealth"
Cohesion: 0.40
Nodes (4): CancellationToken, HttpGet, IActionResult, Task

### Community 164 - "ExceptionMiddleware"
Cohesion: 0.40
Nodes (4): ExceptionMiddleware, HttpContext, RequestDelegate, Task

### Community 165 - "JwtValidationOptions"
Cohesion: 0.40
Nodes (4): JwtValidationOptions, Audience, Issuer, SigningKeyPublic

### Community 167 - "useIdleTimeout.ts"
Cohesion: 0.40
Nodes (3): ACTIVITY_EVENTS, IdleTimeoutOptions, IdleTimeoutState

### Community 168 - "DatePicker.tsx"
Cohesion: 0.40
Nodes (4): DatePicker(), DatePickerProps, DAYS_HEADER, MONTHS

### Community 169 - "AuthProvider"
Cohesion: 0.50
Nodes (3): AuthProvider, Google, Local

### Community 170 - ".BuildTargetModel"
Cohesion: 0.50
Nodes (3): DateTimeOffset, Guid, ModelBuilder

### Community 171 - "SelfOptions"
Cohesion: 0.50
Nodes (3): SelfOptions, FieldSettingsModuleKey, PublicBaseUrl

### Community 172 - "ModuleRegistry/Application/Exceptions/AppExceptions.cs"
Cohesion: 0.50
Nodes (3): ApprovalServiceUnavailableAppException, ConflictAppException, NotFoundAppException

### Community 174 - "AuthService.Domain.Entities"
Cohesion: 0.21
Nodes (4): AuthService.Infrastructure, AuthService.Domain.Enums, AuthService.Application.Exceptions, AuthService.Domain.Entities

### Community 178 - "LeadRecordDto"
Cohesion: 0.10
Nodes (20): LeadRecordDto, AppliedAmount, Branch, CompanyName, CreatedDate, DateOfIncorporation, Email, EmployerName (+12 more)

### Community 190 - "Workflow"
Cohesion: 0.10
Nodes (18): Behavior contract, Markup, Reference wiring, Rules, Styles, The Picker, Hard Rules, Invocation Variants (+10 more)

### Community 191 - ".Update"
Cohesion: 0.29
Nodes (11): RolesController, ActionResult, CancellationToken, Guid, HttpDelete, HttpGet, HttpPost, HttpPut (+3 more)

### Community 192 - "Glossary"
Cohesion: 0.11
Nodes (17): Animation Vocabulary, Easing — how speed changes over an animation, Entrances & Exits — how elements appear and disappear, Examples, Feedback & Interaction — responding to the user's actions, Glossary, Instructions, Looping & Ambient Motion — animations that run on their own (+9 more)

### Community 193 - "Deploying OmniRemit"
Cohesion: 0.11
Nodes (17): 1. `Auth__SameSite=None` is mandatory, 2. The deploy order inverts, Deploying OmniRemit, Deploying without a custom domain, Notes and gotchas, Step 10 — Point the registry at the deployed remote, Step 1 — Databases, Step 2 — Production secrets (+9 more)

### Community 194 - "Finding Animation Opportunities"
Cohesion: 0.12
Nodes (15): 1. Frequency — how often will a user see this?, 2. Purpose — why does this animate?, 3. Speed — can it stay inside budget?, 4. Function — does motion help or hinder here?, Finding Animation Opportunities, Hard Rules, Operating Posture, Part 1 — Opportunities table (+7 more)

### Community 195 - "LeadFieldConfig"
Cohesion: 0.13
Nodes (15): Guid, LeadFieldConfig, ApiField, DisplayLabel, DisplayOrder, Editable, Id, MaskingRule (+7 more)

### Community 196 - "CrmProxyService"
Cohesion: 0.14
Nodes (12): InteractionController, HttpGet, IActionResult, Task, CrmProxyResult, Content, IsSuccess, CrmProxyService (+4 more)

### Community 197 - "CheckerAssignment"
Cohesion: 0.15
Nodes (12): CheckerAssignment, CheckerRole, CheckerRoleId, CheckerUser, CheckerUserId, CreatedAt, CreatedBy, Id (+4 more)

### Community 198 - "MutationResult"
Cohesion: 0.21
Nodes (9): ApprovalPendingDto, MutationResult, InternalApprovalsController, ActionResult, CancellationToken, HttpGet, HttpPost, IActionResult (+1 more)

### Community 199 - "Customer360DbContext"
Cohesion: 0.17
Nodes (9): HealthController, IConfiguration, Customer360DbContext, AuditLogs, FieldConfigs, DbContextOptions, DbSet, ModelBuilder (+1 more)

### Community 200 - "ui/tsconfig.json"
Cohesion: 0.17
Nodes (11): compilerOptions, jsx, lib, noEmit, extends, include, DOM, DOM.Iterable (+3 more)

### Community 201 - "PermissionFeatureCapability"
Cohesion: 0.18
Nodes (9): PermissionFeatureCapability, DisplayName, Feature, FeatureId, Id, Key, SortOrder, Guid (+1 more)

### Community 202 - "AuditDetailsDrawer.tsx"
Cohesion: 0.29
Nodes (9): AuditDetailsDrawer(), formatIpv4(), formatTimestamp(), getActionLabel(), AuditLogsPage(), isEmpty(), LeadDiffTable(), LeadDiffTableProps (+1 more)

### Community 203 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, allowJs, checkJs, noEmit, noUnusedLocals, noUnusedParameters, extends, include (+2 more)

### Community 204 - "The list"
Cohesion: 0.20
Nodes (9): Charts, Common mismatches to catch, How to use this, Interaction & performance, Motion & visuals, Picking The Right Library, State & styling, The list (+1 more)

### Community 205 - "RolePermission"
Cohesion: 0.22
Nodes (8): RolePermission, Capability, Feature, FeatureId, Id, Role, RoleId, Guid

### Community 206 - "SecretProtector"
Cohesion: 0.28
Nodes (5): SecretProtector, IsConfigured, IOptions, SecretProtectionOptions, TempPasswordKey

### Community 207 - "Design Engineering"
Cohesion: 0.22
Nodes (8): Accessibility, Design Engineering, Initial Response, prefers-reduced-motion, Review Checklist, Review Format (Required), Stagger Animations, Touch device hover states

### Community 208 - "Component Building Principles"
Cohesion: 0.25
Nodes (8): Animate enter states with @starting-style, Buttons must feel responsive, Component Building Principles, Make popovers origin-aware, Never animate from scale(0), Tooltips: skip delay on subsequent hovers, Use blur to mask imperfect transitions, Use CSS transitions over keyframes for interruptible UI

### Community 209 - "Adding a New Remote App"
Cohesion: 0.25
Nodes (7): 1. Scaffold the frontend, 2. Add it to the launcher, 3. Stand up the backend (if it has one), 4. Register it, 5. Verify, Adding a New Remote App, The five things that must be unique per app

### Community 210 - ".SeedMasterData"
Cohesion: 0.33
Nodes (5): Branch, ModelBuilder, Product, State, Product

### Community 211 - "Performance: measured baseline, and the infrastructure work left to do"
Cohesion: 0.29
Nodes (6): Already done in the code, How to reproduce, Performance: measured baseline, and the infrastructure work left to do, What cannot be fixed from inside this repository, What the numbers actually say, What was measured

### Community 212 - "formatDate.ts"
Cohesion: 0.57
Nodes (6): EMPTY_VALUE, formatDate(), formatDateTime(), formatRelativeTime(), formatTime(), toDate()

### Community 213 - "SalesExecutive"
Cohesion: 0.33
Nodes (6): SalesExecutive, Email, Id, IsActive, Name, StaffId

### Community 214 - "The Animation Decision Framework"
Cohesion: 0.33
Nodes (6): 1. Should this animate at all?, 2. What is the purpose?, 3. What easing should it use?, 4. How fast should it be?, Perceived performance, The Animation Decision Framework

### Community 215 - "clip-path for Animation"
Cohesion: 0.33
Nodes (6): clip-path for Animation, Comparison sliders, Hold-to-delete pattern, Image reveals on scroll, Tabs with perfect color transitions, The inset shape

### Community 216 - "Performance Rules"
Cohesion: 0.33
Nodes (6): CSS animations beat JS under load, CSS variables are inheritable, Framer Motion hardware acceleration caveat, Only animate transform and opacity, Performance Rules, Use WAAPI for programmatic CSS animations

### Community 217 - "Gesture and Drag Interactions"
Cohesion: 0.33
Nodes (6): Damping at boundaries, Friction instead of hard stops, Gesture and Drag Interactions, Momentum-based dismissal, Multi-touch protection, Pointer capture for drag

### Community 218 - "SelfOptions"
Cohesion: 0.40
Nodes (4): SelfOptions, FieldSettingsModuleKey, LeadModuleKey, PublicBaseUrl

### Community 219 - "CSS Transform Mastery"
Cohesion: 0.40
Nodes (5): 3D transforms for depth, CSS Transform Mastery, scale() scales children too, transform-origin, translateY with percentages

### Community 220 - "The Sonner Principles (Building Loved Components)"
Cohesion: 0.40
Nodes (5): Asymmetric enter/exit timing, Cohesion matters, Review your work the next day, The opacity + height combination, The Sonner Principles (Building Loved Components)

### Community 221 - "Spring Animations"
Cohesion: 0.40
Nodes (5): Interruptibility advantage, Spring Animations, Spring-based mouse interactions, Spring configuration, When to use springs

### Community 222 - "PagedResult"
Cohesion: 0.50
Nodes (3): PagedResult, ProblemResponse, IReadOnlyList

### Community 223 - "Core Philosophy"
Cohesion: 0.50
Nodes (4): Beauty is leverage, Core Philosophy, Taste is trained, not innate, Unseen details compound

### Community 224 - "Debugging Animations"
Cohesion: 0.50
Nodes (4): Debugging Animations, Frame-by-frame inspection, Slow motion testing, Test on real devices

### Community 225 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + Vite

### Community 226 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

## Knowledge Gaps
- **1606 isolated node(s):** `ApprovalModuleKeys`, `ApprovalActionKeys`, `ApprovalStatus`, `ProblemResponse`, `Pending` (+1601 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 2072 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AuthDbContext` connect `AuthDbContext` to `RoleAppService`, `AuditLog`, `.CreateAsync`, `AuthAppService`, `Role`, `PermissionCatalogAppService`, `ApprovalAppService`, `PermissionFeature`, `.UpsertAsync`, `AuthService.Domain.Entities`, `ApprovalRequest`, `.WriteAsync`, `CheckerAssignment`, `.GetStatsAsync`, `Customer360DbContext`, `PermissionFeatureCapability`, `RolePermission`, `.Search`, `SetPasswordInviteService`, `UserPermissionOverride`, `RefreshToken`, `SetPasswordInvite`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `ApplicationDbContext` connect `ApplicationDbContext` to `MasterEntities.cs`, `LeadFieldConfig`, `AuditLog`, `Customer360DbContext`, `LeadManagement.Api.Models.Dtos`, `LeadConsentDetail`, `ControllerBase`, `DashboardFilterDto`, `.UpdateLeadAsync`, `Branch`, `.SeedMasterData`, `SalesExecutive`, `AuditLogDto`, `State`, `LeadFieldConfigService`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `StatusCode` connect `StatusCode` to `.Replace`, `.GetHealth`, `CrmProxyService`, `.Ok`, `.Replace`, `.GetCorporateProfile`, `.DeleteLead`, `ContactDetail`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `ApprovalModuleKeys`, `ApprovalActionKeys`, `ApprovalStatus` to the rest of the system?**
  _1606 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `KpiSummaryDto` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `authStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.04186952288218111 - nodes in this community are weakly interconnected._
- **Should `IndividualProfile` be split into smaller, more focused modules?**
  _Cohesion score 0.029411764705882353 - nodes in this community are weakly interconnected._