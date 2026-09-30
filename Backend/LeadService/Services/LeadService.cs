using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Options;

namespace LeadManagement.Api.Services
{
    public interface ILeadService
    {
        Task<MutationResult<LeadRecordDto>> CreateLeadAsync(CreateLeadDto dto, Guid? actingUserId, bool bypassApproval = false);
        Task<PagedResultDto<LeadRecordDto>> GetLeadsAsync(
            int page,
            int pageSize,
            string? search,
            string? product,
            string? branch,
            string? state,
            string? salesExecutive,
            string? month,
            string? createdDate,
            string? createdFrom = null,
            string? createdTo = null,
            string? name = null,
            string? icNumber = null,
            string? phone = null,
            string? status = null,
            string? leadSource = null);
        Task<LeadRecordDto?> GetLeadByIdAsync(string id);
        Task<MutationResult<LeadRecordDto>> UpdateLeadAsync(string id, UpdateLeadDto dto, Guid? actingUserId, bool bypassApproval = false);
        /// <summary>Null once actually deleted; an ApprovalPendingDto if the delete was gated instead. Throws KeyNotFoundException if the lead doesn't exist.</summary>
        Task<ApprovalPendingDto?> DeleteLeadAsync(string id, DeleteLeadDto dto, Guid? actingUserId, bool bypassApproval = false);
        Task LogLeadViewAsync(string id);
    }

    public class LeadService : ILeadService
    {
        private readonly ApplicationDbContext _db;
        private readonly IAuditLogService _auditLogService;
        private readonly AuthServiceClient _authServiceClient;
        private readonly SelfOptions _selfOptions;
        private readonly LeadFieldConfigService _fieldConfigService;
        private readonly ValidationPresetClient _presets;
        private readonly ProductCatalogClient _catalog;

        public LeadService(ApplicationDbContext db, IAuditLogService auditLogService, AuthServiceClient authServiceClient, IOptions<SelfOptions> selfOptions, LeadFieldConfigService fieldConfigService, ValidationPresetClient presets, ProductCatalogClient catalog)
        {
            _presets = presets;
            _catalog = catalog;
            _db = db;
            _auditLogService = auditLogService;
            _authServiceClient = authServiceClient;
            _selfOptions = selfOptions.Value;
            _fieldConfigService = fieldConfigService;
        }

        /// <summary>Checks gating and, if gated, submits — the same "after validation, before mutation"
        /// surgical insert AuthService's own UserAppService/RoleAppService use. Returns null when the
        /// caller should proceed to mutate directly.</summary>
        private async Task<ApprovalPendingDto?> TrySubmitForApprovalAsync(
            string action, string? entityId, string entityLabel, string? oldDataJson, object requestBody, Guid? actingUserId, bool bypassApproval,
            string? entityKey = null)
        {
            if (bypassApproval || actingUserId is null)
            {
                return null;
            }

            if (!await _authServiceClient.IsGatedAsync(_selfOptions.LeadModuleKey))
            {
                return null;
            }

            var callbackUrl = $"{_selfOptions.PublicBaseUrl.TrimEnd('/')}/internal/approvals/apply";
            return await _authServiceClient.SubmitApprovalAsync(
                _selfOptions.LeadModuleKey, action, "Lead", entityId, entityLabel,
                oldDataJson, System.Text.Json.JsonSerializer.Serialize(requestBody), actingUserId.Value,
                callbackUrl, Guid.NewGuid().ToString(), entityKey: entityKey);
        }

        /// <summary>
        /// The product a new lead is for, confirmed with the Marketplace right now — never from a cache and
        /// never from what the browser says it is called. A product that was withdrawn (or whose category or
        /// sub-category was switched off in Setup) since the form was opened is refused here.
        /// </summary>
        private async Task<CatalogProduct> ResolveProductAsync(Guid catalogProductId)
        {
            if (catalogProductId == Guid.Empty)
            {
                throw new InvalidOperationException("Product selection is required.");
            }

            return await _catalog.GetProductAsync(catalogProductId)
                ?? throw new InvalidOperationException("That product is no longer offered. Please choose another product.");
        }

        private static void ApplyProductSnapshot(Lead lead, CatalogProduct product)
        {
            lead.CatalogProductId = product.Id;
            lead.ProductName = product.Name;
            lead.ProductCode = product.Code;
            lead.CatalogSubCategoryId = product.SubCategoryId;
            lead.SubCategoryName = product.SubCategoryName;
            lead.SubCategoryCode = product.SubCategoryCode;
            lead.CatalogCategoryId = product.CategoryId;
            lead.CategoryName = product.CategoryName;
            lead.CategoryCode = product.CategoryCode;
        }

        private static bool HasHomeFinancingDetails(CreateLeadDto dto) =>
            !string.IsNullOrWhiteSpace(dto.PropertyType) || !string.IsNullOrWhiteSpace(dto.PropertyStatus);

        private static bool HasMicrofinanceDetails(CreateLeadDto dto) =>
            !string.IsNullOrWhiteSpace(dto.CompanyName) || !string.IsNullOrWhiteSpace(dto.EntityType) || !string.IsNullOrWhiteSpace(dto.DateOfIncorporation);

        public async Task<MutationResult<LeadRecordDto>> CreateLeadAsync(CreateLeadDto dto, Guid? actingUserId, bool bypassApproval = false)
        {
            // Resolve foreign keys
            var product = await ResolveProductAsync(dto.CatalogProductId);

            var state = await _db.States.FirstOrDefaultAsync(s => s.Name.ToLower() == dto.State.Trim().ToLower())
                ?? throw new InvalidOperationException($"State '{dto.State}' is not recognized.");

            Branch? branch = null;
            if (!string.IsNullOrWhiteSpace(dto.PreferredBranch))
            {
                branch = await _db.Branches.FirstOrDefaultAsync(b => b.Name.ToLower() == dto.PreferredBranch.Trim().ToLower());
            }

            SalesExecutive? salesExec = null;
            if (dto.HasPreferredSalesExecutive && !string.IsNullOrWhiteSpace(dto.PreferredSalesExecutive))
            {
                salesExec = await _db.SalesExecutives.FirstOrDefaultAsync(se => se.Name.ToLower() == dto.PreferredSalesExecutive.Trim().ToLower());
            }

            // Field Settings' per-product Required rule — CreateLeadDto's own [Required] attributes
            // were deliberately removed from every catalog field so this config-driven check is the
            // only thing deciding presence (format validators like [EmailAddress]/[RegularExpression]
            // stay on the DTO and still apply once a value IS present).
            var fieldConfigs = await _fieldConfigService.GetBySubCategoryAsync(product.SubCategoryId);
            LeadFieldConfigService.EnsureRequiredFieldsPresent(fieldConfigs, dto, product.Name);

            // Field Settings' formats (IC number, phone, email and anything an administrator added), checked
            // before the approval gate and again when an approved request is replayed through here.
            LeadFieldConfigService.EnsureFormatsValid(fieldConfigs, dto, await _presets.GetAsync());

            /*
             * A Create has no entity id yet, so it must supply a natural key or AuthService's
             * one-open-request-per-record guarantee silently does nothing for it: the dedupe key falls
             * back to the null entity id, and Postgres treats NULLs as distinct, so the partial unique
             * index never fires and the same lead can be submitted for approval twice.
             *
             * IC number identifies the person; product is included because the same person may
             * legitimately have separate leads for different products, and blocking that would be
             * wrong. The product is keyed by its catalogue id, not its name, so renaming a product does
             * not let the same person be submitted twice. Lowercased and trimmed so trivial formatting
             * differences in the IC number cannot defeat the match.
             */
            var createKey = $"lead:{dto.IcNumber.Trim().ToLowerInvariant()}:{product.Id:N}";

            var pending = await TrySubmitForApprovalAsync(
                "Create", null, dto.CustomerName.Trim(), null, dto, actingUserId, bypassApproval, entityKey: createKey);
            if (pending is not null)
            {
                return MutationResult<LeadRecordDto>.PendingApproval(pending);
            }

            decimal.TryParse(dto.AppliedAmount.Replace(",", "").Trim(), out var parsedAmount);

            var leadRef = $"LEAD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Random.Shared.Next(1000, 9999)}";

            var lead = new Lead
            {
                LeadReference = leadRef,
                CustomerName = dto.CustomerName.Trim(),
                IcNumber = dto.IcNumber.Trim(),
                PhoneCountryCode = string.IsNullOrWhiteSpace(dto.PhoneCountryCode) ? "+60" : dto.PhoneCountryCode.Trim(),
                PhoneNumber = dto.PhoneNumber.Trim(),
                Email = dto.Email.Trim(),
                StateId = state.Id,
                BranchId = branch?.Id,
                EmployerName = dto.EmployerName.Trim(),
                AppliedAmount = parsedAmount,
                HasPreferredSalesExecutive = dto.HasPreferredSalesExecutive,
                PreferredSalesExecutiveId = salesExec?.Id,
                Status = "New",
                IsDeleted = false,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            ApplyProductSnapshot(lead, product);

            _db.Leads.Add(lead);
            await _db.SaveChangesAsync();

            // Product details the lead form collected for this sub-category (which of them apply is
            // Field Settings' decision, so what was actually filled in is what is kept).
            if (HasHomeFinancingDetails(dto))
            {
                _db.LeadHomeFinancingDetails.Add(new LeadHomeFinancingDetail
                {
                    LeadId = lead.Id,
                    PropertyType = dto.PropertyType,
                    PropertyStatus = dto.PropertyStatus
                });
            }

            if (HasMicrofinanceDetails(dto))
            {
                _db.LeadMicrofinanceDetails.Add(new LeadMicrofinanceDetail
                {
                    LeadId = lead.Id,
                    DateOfIncorporation = dto.DateOfIncorporation,
                    CompanyName = dto.CompanyName,
                    EntityType = dto.EntityType
                });
            }

            // Consents
            _db.LeadConsentDetails.Add(new LeadConsentDetail
            {
                LeadId = lead.Id,
                MarketingConsent = dto.MarketingConsent,
                AgreedToPrivacyPolicy = dto.AgreedToPrivacyPolicy,
                ConsentedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync();

            var result = new LeadRecordDto
            {
                Id = lead.Id.ToString(),
                Name = lead.CustomerName,
                IcNumber = lead.IcNumber,
                Phone = $"{lead.PhoneCountryCode} {lead.PhoneNumber}".Trim(),
                Email = lead.Email,
                Product = product.Name,
                CatalogProductId = lead.CatalogProductId,
                CategoryName = lead.CategoryName,
                SubCategoryId = lead.CatalogSubCategoryId,
                SubCategoryName = lead.SubCategoryName,
                State = state.Name,
                Branch = branch?.Name ?? "Not Assigned",
                Status = lead.Status,
                CreatedDate = lead.CreatedAt.ToString("yyyy-MM-dd"),
                EmployerName = lead.EmployerName,
                AppliedAmount = lead.AppliedAmount.ToString("N2"),
                PreferredSalesExecutive = salesExec?.Name
            };

            await _auditLogService.LogAsync(
                actionType: "Create",
                entityType: "Lead",
                entityId: lead.Id.ToString(),
                description: $"Created new lead record for customer '{lead.CustomerName}' (Product: {product.Name})",
                newValues: System.Text.Json.JsonSerializer.Serialize(result)
            );

            return MutationResult<LeadRecordDto>.Ok(result);
        }

        public async Task<PagedResultDto<LeadRecordDto>> GetLeadsAsync(
            int page,
            int pageSize,
            string? search,
            string? product,
            string? branch,
            string? state,
            string? salesExecutive,
            string? month,
            string? createdDate,
            string? createdFrom = null,
            string? createdTo = null,
            string? name = null,
            string? icNumber = null,
            string? phone = null,
            string? status = null,
            string? leadSource = null)
        {
            var q = _db.Leads
                .AsNoTracking()
                .Where(l => !l.IsDeleted)
                .Include(l => l.State)
                .Include(l => l.Branch)
                .Include(l => l.PreferredSalesExecutive)
                .Include(l => l.HomeFinancingDetail)
                .Include(l => l.MicrofinanceDetail)
                .Include(l => l.ConsentDetail)
                .AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(l =>
                    l.CustomerName.ToLower().Contains(s) ||
                    l.IcNumber.ToLower().Contains(s) ||
                    l.PhoneNumber.ToLower().Contains(s) ||
                    l.Email.ToLower().Contains(s) ||
                    (l.Branch != null && l.Branch.Name.ToLower().Contains(s)) ||
                    l.ProductName.ToLower().Contains(s) ||
                    l.CategoryName.ToLower().Contains(s)
                );
            }

            if (!string.IsNullOrWhiteSpace(product))
            {
                var prods = product.Split(',').Select(p => p.Trim().ToLower()).Where(p => p.Length > 0).ToList();
                if (prods.Count > 0)
                {
                    q = q.Where(l => prods.Contains(l.ProductName.ToLower()));
                }
            }

            if (!string.IsNullOrWhiteSpace(branch))
            {
                var branches = branch.Split(',').Select(b => b.Trim().ToLower()).Where(b => b.Length > 0).ToList();
                if (branches.Count > 0)
                {
                    q = q.Where(l => l.Branch != null && branches.Contains(l.Branch.Name.ToLower()));
                }
            }

            if (!string.IsNullOrWhiteSpace(state))
            {
                var st = state.Trim().ToLower();
                q = q.Where(l => l.State != null && l.State.Name.ToLower() == st);
            }

            if (!string.IsNullOrWhiteSpace(salesExecutive))
            {
                var se = salesExecutive.Trim().ToLower();
                q = q.Where(l => l.PreferredSalesExecutive != null && l.PreferredSalesExecutive.Name.ToLower() == se);
            }

            if (!string.IsNullOrWhiteSpace(name))
            {
                var n = name.Trim().ToLower();
                q = q.Where(l => l.CustomerName.ToLower().Contains(n));
            }

            if (!string.IsNullOrWhiteSpace(icNumber))
            {
                var ic = icNumber.Trim().ToLower();
                q = q.Where(l => l.IcNumber.ToLower().Contains(ic));
            }

            if (!string.IsNullOrWhiteSpace(phone))
            {
                var ph = phone.Trim().ToLower();
                q = q.Where(l => l.PhoneNumber.ToLower().Contains(ph) || (l.PhoneCountryCode + l.PhoneNumber).ToLower().Contains(ph));
            }

            if (!string.IsNullOrWhiteSpace(status))
            {
                var statuses = status.Split(',').Select(s => s.Trim().ToLower()).Where(s => s.Length > 0).ToList();
                if (statuses.Count > 0)
                {
                    q = q.Where(l => statuses.Contains(l.Status.ToLower()));
                }
            }

            if (!string.IsNullOrWhiteSpace(month))
            {
                var mStr = month.Trim().ToLower();
                int monthNum = mStr switch
                {
                    "january" or "jan" or "1" => 1,
                    "february" or "feb" or "2" => 2,
                    "march" or "mar" or "3" => 3,
                    "april" or "apr" or "4" => 4,
                    "may" or "5" => 5,
                    "june" or "jun" or "6" => 6,
                    "july" or "jul" or "7" => 7,
                    "august" or "aug" or "8" => 8,
                    "september" or "sep" or "9" => 9,
                    "october" or "oct" or "10" => 10,
                    "november" or "nov" or "11" => 11,
                    "december" or "dec" or "12" => 12,
                    _ => int.TryParse(mStr, out var n) ? n : 0
                };

                if (monthNum >= 1 && monthNum <= 12)
                {
                    q = q.Where(l => l.CreatedAt.Month == monthNum);
                }
                else
                {
                    q = q.Where(l => false);
                }
            }

            if (!string.IsNullOrWhiteSpace(createdDate))
            {
                if (DateTime.TryParse(createdDate.Trim(), out var parsedDate))
                {
                    var targetDate = parsedDate.Date;
                    q = q.Where(l => l.CreatedAt.Date == targetDate);
                }
                else
                {
                    q = q.Where(l => false);
                }
            }

            if (!string.IsNullOrWhiteSpace(createdFrom) && DateTime.TryParse(createdFrom.Trim(), out var fromDate))
            {
                var startUtc = DateTime.SpecifyKind(fromDate.Date, DateTimeKind.Utc);
                q = q.Where(l => l.CreatedAt >= startUtc);
            }

            if (!string.IsNullOrWhiteSpace(createdTo) && DateTime.TryParse(createdTo.Trim(), out var toDate))
            {
                var endUtc = DateTime.SpecifyKind(toDate.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc);
                q = q.Where(l => l.CreatedAt <= endUtc);
            }

            var totalRecords = await q.CountAsync();

            // Same reasoning as AuditLogService: the old branch set pageSize to totalRecords, which
            // returned the entire table for any out-of-range request instead of limiting it.
            pageSize = Math.Clamp(pageSize, 1, 100);

            page = Math.Max(1, page);
            var totalPages = (int)Math.Ceiling((double)totalRecords / pageSize);
            if (totalPages == 0) totalPages = 1;

            var items = await q.OrderByDescending(l => l.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(l => new LeadRecordDto
                {
                    Id = l.Id.ToString(),
                    Name = l.CustomerName,
                    IcNumber = l.IcNumber,
                    Phone = $"{l.PhoneCountryCode} {l.PhoneNumber}".Trim(),
                    Email = l.Email,
                    Product = l.ProductName,
                    CatalogProductId = l.CatalogProductId,
                    CategoryName = l.CategoryName,
                    SubCategoryId = l.CatalogSubCategoryId,
                    SubCategoryName = l.SubCategoryName,
                    State = l.State != null ? l.State.Name : string.Empty,
                    Branch = l.Branch != null ? l.Branch.Name : "Not Assigned",
                    Status = l.Status,
                    CreatedDate = l.CreatedAt.ToString("yyyy-MM-dd"),
                    EmployerName = l.EmployerName,
                    AppliedAmount = l.AppliedAmount.ToString("N2"),
                    PreferredSalesExecutive = l.PreferredSalesExecutive != null ? l.PreferredSalesExecutive.Name : null,
                    PropertyType = l.HomeFinancingDetail != null ? l.HomeFinancingDetail.PropertyType : null,
                    PropertyStatus = l.HomeFinancingDetail != null ? l.HomeFinancingDetail.PropertyStatus : null,
                    DateOfIncorporation = l.MicrofinanceDetail != null ? l.MicrofinanceDetail.DateOfIncorporation : null,
                    CompanyName = l.MicrofinanceDetail != null ? l.MicrofinanceDetail.CompanyName : null,
                    EntityType = l.MicrofinanceDetail != null ? l.MicrofinanceDetail.EntityType : null,
                    MarketingConsent = l.ConsentDetail != null ? l.ConsentDetail.MarketingConsent : null
                })
                .ToListAsync();

            return new PagedResultDto<LeadRecordDto>
            {
                Items = items,
                TotalRecords = totalRecords,
                Page = page,
                PageSize = pageSize,
                TotalPages = totalPages
            };
        }

        public async Task<LeadRecordDto?> GetLeadByIdAsync(string id)
        {
            if (!Guid.TryParse(id, out var guid)) return null;

            var l = await _db.Leads
                .AsNoTracking()
                .Where(x => !x.IsDeleted)
                .Include(x => x.State)
                .Include(x => x.Branch)
                .Include(x => x.PreferredSalesExecutive)
                .Include(x => x.HomeFinancingDetail)
                .Include(x => x.MicrofinanceDetail)
                .Include(x => x.ConsentDetail)
                .FirstOrDefaultAsync(x => x.Id == guid);

            if (l == null) return null;

            return new LeadRecordDto
            {
                Id = l.Id.ToString(),
                Name = l.CustomerName,
                IcNumber = l.IcNumber,
                Phone = $"{l.PhoneCountryCode} {l.PhoneNumber}".Trim(),
                Email = l.Email,
                Product = l.ProductName,
                CatalogProductId = l.CatalogProductId,
                CategoryName = l.CategoryName,
                SubCategoryId = l.CatalogSubCategoryId,
                SubCategoryName = l.SubCategoryName,
                State = l.State?.Name ?? string.Empty,
                Branch = l.Branch?.Name ?? "Not Assigned",
                Status = l.Status,
                CreatedDate = l.CreatedAt.ToString("yyyy-MM-dd"),
                EmployerName = l.EmployerName,
                AppliedAmount = l.AppliedAmount.ToString("N2"),
                PreferredSalesExecutive = l.PreferredSalesExecutive?.Name,
                PropertyType = l.HomeFinancingDetail?.PropertyType,
                PropertyStatus = l.HomeFinancingDetail?.PropertyStatus,
                DateOfIncorporation = l.MicrofinanceDetail?.DateOfIncorporation,
                CompanyName = l.MicrofinanceDetail?.CompanyName,
                EntityType = l.MicrofinanceDetail?.EntityType,
                MarketingConsent = l.ConsentDetail?.MarketingConsent
            };
        }

        public async Task<MutationResult<LeadRecordDto>> UpdateLeadAsync(string id, UpdateLeadDto dto, Guid? actingUserId, bool bypassApproval = false)
        {
            if (!Guid.TryParse(id, out var guid))
                throw new KeyNotFoundException($"Lead with ID '{id}' was not found.");

            var lead = await _db.Leads
                .Include(l => l.State)
                .Include(l => l.Branch)
                .Include(l => l.PreferredSalesExecutive)
                .Include(l => l.HomeFinancingDetail)
                .Include(l => l.MicrofinanceDetail)
                .Include(l => l.ConsentDetail)
                .FirstOrDefaultAsync(l => l.Id == guid && !l.IsDeleted);

            if (lead == null)
                throw new KeyNotFoundException($"Lead with ID '{id}' was not found.");

            var previousDto = await GetLeadByIdAsync(id);

            /*
             * The product. A lead keeps the product it was taken for: leaving the id out, or sending its own,
             * changes nothing and asks nothing of the Marketplace — a lead for a product that has since been
             * withdrawn (or that predates the catalogue) must stay editable. Only choosing a *different*
             * product is confirmed with the Marketplace, and only a product it currently offers is accepted.
             */
            CatalogProduct? newProduct = null;
            if (dto.CatalogProductId != Guid.Empty && dto.CatalogProductId != lead.CatalogProductId)
            {
                newProduct = await ResolveProductAsync(dto.CatalogProductId);
            }

            var subCategoryId = newProduct?.SubCategoryId ?? lead.CatalogSubCategoryId;
            var productName = newProduct?.Name ?? lead.ProductName;

            var state = await _db.States.FirstOrDefaultAsync(s => s.Name.ToLower() == dto.State.Trim().ToLower())
                ?? throw new InvalidOperationException($"State '{dto.State}' is not recognized.");

            Branch? branch = null;
            if (!string.IsNullOrWhiteSpace(dto.PreferredBranch))
            {
                branch = await _db.Branches.FirstOrDefaultAsync(b => b.Name.ToLower() == dto.PreferredBranch.Trim().ToLower());
            }

            SalesExecutive? salesExec = null;
            if (dto.HasPreferredSalesExecutive && !string.IsNullOrWhiteSpace(dto.PreferredSalesExecutive))
            {
                salesExec = await _db.SalesExecutives.FirstOrDefaultAsync(se => se.Name.ToLower() == dto.PreferredSalesExecutive.Trim().ToLower());
            }

            // Field Settings' per-sub-category Required/Editable rules — see CreateLeadAsync's comment for
            // why Required is config-driven rather than a DTO attribute. Editable is checked here
            // (Update only — nothing to compare against on Create) against previousDto, the same
            // pre-mutation read-model snapshot already fetched above for the audit diff.
            // A lead that predates the catalogue has no sub-category, so nothing configures its form.
            var fieldConfigs = subCategoryId is { } sub ? await _fieldConfigService.GetBySubCategoryAsync(sub) : [];
            LeadFieldConfigService.EnsureRequiredFieldsPresent(fieldConfigs, dto, productName);
            LeadFieldConfigService.EnsureEditableFieldsUnchanged(fieldConfigs, dto, previousDto!);
            LeadFieldConfigService.EnsureFormatsValid(fieldConfigs, dto, await _presets.GetAsync(), previousDto);

            var oldSnapshot = System.Text.Json.JsonSerializer.Serialize(previousDto);
            var pending = await TrySubmitForApprovalAsync("Update", id, lead.CustomerName, oldSnapshot, dto, actingUserId, bypassApproval);
            if (pending is not null)
            {
                return MutationResult<LeadRecordDto>.PendingApproval(pending);
            }

            decimal.TryParse(dto.AppliedAmount.Replace(",", "").Trim(), out var parsedAmount);

            lead.CustomerName = dto.CustomerName.Trim();
            lead.IcNumber = dto.IcNumber.Trim();
            lead.PhoneCountryCode = string.IsNullOrWhiteSpace(dto.PhoneCountryCode) ? "+60" : dto.PhoneCountryCode.Trim();
            lead.PhoneNumber = dto.PhoneNumber.Trim();
            lead.Email = dto.Email.Trim();
            if (newProduct is not null) ApplyProductSnapshot(lead, newProduct);
            lead.StateId = state.Id;
            lead.BranchId = branch?.Id;
            lead.EmployerName = dto.EmployerName.Trim();
            lead.AppliedAmount = parsedAmount;
            lead.HasPreferredSalesExecutive = dto.HasPreferredSalesExecutive;
            lead.PreferredSalesExecutiveId = salesExec?.Id;
            lead.UpdatedAt = DateTime.UtcNow;

            // Product details: written when the form supplied them, and kept in step when a row already
            // exists (so a value can be cleared). Which fields the form shows is Field Settings' decision.
            if (HasHomeFinancingDetails(dto) || lead.HomeFinancingDetail != null)
            {
                if (lead.HomeFinancingDetail == null)
                {
                    lead.HomeFinancingDetail = new LeadHomeFinancingDetail { LeadId = lead.Id };
                    _db.LeadHomeFinancingDetails.Add(lead.HomeFinancingDetail);
                }
                lead.HomeFinancingDetail.PropertyType = dto.PropertyType;
                lead.HomeFinancingDetail.PropertyStatus = dto.PropertyStatus;
            }

            if (HasMicrofinanceDetails(dto) || lead.MicrofinanceDetail != null)
            {
                if (lead.MicrofinanceDetail == null)
                {
                    lead.MicrofinanceDetail = new LeadMicrofinanceDetail { LeadId = lead.Id };
                    _db.LeadMicrofinanceDetails.Add(lead.MicrofinanceDetail);
                }
                lead.MicrofinanceDetail.DateOfIncorporation = dto.DateOfIncorporation;
                lead.MicrofinanceDetail.CompanyName = dto.CompanyName;
                lead.MicrofinanceDetail.EntityType = dto.EntityType;
            }

            // Consents
            if (lead.ConsentDetail == null)
            {
                lead.ConsentDetail = new LeadConsentDetail { LeadId = lead.Id };
                _db.LeadConsentDetails.Add(lead.ConsentDetail);
            }
            lead.ConsentDetail.MarketingConsent = dto.MarketingConsent;
            lead.ConsentDetail.AgreedToPrivacyPolicy = dto.AgreedToPrivacyPolicy;

            await _db.SaveChangesAsync();

            var newDto = await GetLeadByIdAsync(id);

            // Calculate diffs for audit log
            var diffList = new List<object>();
            void Compare(string fieldName, string? oldVal, string? newVal)
            {
                var o = (oldVal ?? "").Trim();
                var n = (newVal ?? "").Trim();
                if (o != n)
                {
                    diffList.Add(new { field = fieldName, previousValue = string.IsNullOrEmpty(o) ? "—" : o, newValue = string.IsNullOrEmpty(n) ? "—" : n });
                }
            }

            if (previousDto != null && newDto != null)
            {
                Compare("Customer Name", previousDto.Name, newDto.Name);
                Compare("IC Number", previousDto.IcNumber, newDto.IcNumber);
                Compare("Phone", previousDto.Phone, newDto.Phone);
                Compare("Email", previousDto.Email, newDto.Email);
                Compare("Product", previousDto.Product, newDto.Product);
                Compare("State", previousDto.State, newDto.State);
                Compare("Branch", previousDto.Branch, newDto.Branch);
                Compare("Employer Name", previousDto.EmployerName, newDto.EmployerName);
                Compare("Applied Amount", previousDto.AppliedAmount, newDto.AppliedAmount);
                Compare("Preferred Sales Executive", previousDto.PreferredSalesExecutive, newDto.PreferredSalesExecutive);
                Compare("Property Type", previousDto.PropertyType, newDto.PropertyType);
                Compare("Property Status", previousDto.PropertyStatus, newDto.PropertyStatus);
                Compare("Company Name", previousDto.CompanyName, newDto.CompanyName);
                Compare("Entity Type", previousDto.EntityType, newDto.EntityType);
                Compare("Date of Incorporation", previousDto.DateOfIncorporation, newDto.DateOfIncorporation);
                Compare("Marketing Consent", previousDto.MarketingConsent, newDto.MarketingConsent);
            }

            var diffJson = System.Text.Json.JsonSerializer.Serialize(diffList);
            var prevJson = System.Text.Json.JsonSerializer.Serialize(previousDto);
            var newJson = System.Text.Json.JsonSerializer.Serialize(newDto);

            await _auditLogService.LogAsync(
                actionType: "Edit",
                entityType: "Lead",
                entityId: lead.Id.ToString(),
                description: $"Updated lead information for customer '{lead.CustomerName}'",
                reason: dto.EditReason,
                previousValues: diffJson,
                newValues: newJson
            );

            return MutationResult<LeadRecordDto>.Ok(newDto!);
        }

        public async Task<ApprovalPendingDto?> DeleteLeadAsync(string id, DeleteLeadDto dto, Guid? actingUserId, bool bypassApproval = false)
        {
            if (!Guid.TryParse(id, out var guid))
                throw new KeyNotFoundException($"Lead with ID '{id}' was not found.");

            var lead = await _db.Leads
                .Include(l => l.HomeFinancingDetail)
                .Include(l => l.MicrofinanceDetail)
                .Include(l => l.ConsentDetail)
                .FirstOrDefaultAsync(l => l.Id == guid);

            if (lead == null)
                throw new KeyNotFoundException($"Lead with ID '{id}' was not found.");

            var leadDto = await GetLeadByIdAsync(id);

            var pending = await TrySubmitForApprovalAsync("Delete", id, lead.CustomerName, null, dto, actingUserId, bypassApproval);
            if (pending is not null)
            {
                return pending;
            }

            await _auditLogService.LogAsync(
                actionType: "Delete",
                entityType: "Lead",
                entityId: id,
                description: $"Deleted lead record for customer '{lead.CustomerName}'",
                reason: dto.DeleteReason,
                previousValues: System.Text.Json.JsonSerializer.Serialize(leadDto)
            );

            _db.Leads.Remove(lead);
            await _db.SaveChangesAsync();

            return null;
        }

        public async Task LogLeadViewAsync(string id)
        {
            var leadDto = await GetLeadByIdAsync(id);
            if (leadDto != null)
            {
                await _auditLogService.LogAsync(
                    actionType: "View",
                    entityType: "Lead",
                    entityId: id,
                    description: $"Viewed detailed lead record for customer '{leadDto.Name}'"
                );
            }
        }
    }
}
