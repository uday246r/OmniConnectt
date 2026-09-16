using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Options;

namespace LeadManagement.Api.Services
{
    /// <summary>
    /// Lead Management's own "Field Settings" — a separate implementation from Customer360Service's
    /// FieldConfig, deliberately not shared, mirroring its shape (label/visibility/section/order/
    /// sensitive/masking, full-replace-by-ApiField semantics, Maker-Checker gated) but keyed by
    /// Product (a real DB row here, not a fixed profile-type enum) and extended with two columns
    /// Customer360's version doesn't have — Required and Editable — both enforced server-side by this
    /// service, not just cosmetic.
    ///
    /// This is config over the fields that ALREADY EXIST in code — never a schema/EAV mechanism for
    /// inventing new data columns. The fixed catalog (seeded by EnsureSeededAsync):
    ///   Common (every product): customerName, icNumber, phoneNumber, email, state, branch,
    ///     employerName, appliedAmount, hasPreferredSalesExecutive, preferredSalesExecutive,
    ///     marketingConsent, agreedToPrivacyPolicy.
    ///   Home Financing only: propertyType, propertyStatus.
    ///   Micro Finance only: dateOfIncorporation, companyName, entityType.
    /// hasPreferredSalesExecutive/preferredSalesExecutive's existing "if checked, the dropdown becomes
    /// mandatory" conditional stays its own hardcoded rule (LeadService.CreateLeadAsync/UpdateLeadAsync
    /// never touch it) — preferredSalesExecutive is seeded Required:false so the two conditionality
    /// mechanisms don't fight each other.
    /// </summary>
    public class LeadFieldConfigService
    {
        private readonly ApplicationDbContext _db;
        private readonly AuthServiceClient _authServiceClient;
        private readonly SelfOptions _selfOptions;

        public LeadFieldConfigService(ApplicationDbContext db, AuthServiceClient authServiceClient, IOptions<SelfOptions> selfOptions)
        {
            _db = db;
            _authServiceClient = authServiceClient;
            _selfOptions = selfOptions.Value;
        }

        public async Task<List<LeadFieldConfig>> GetByProductAsync(Guid productId, CancellationToken ct = default) =>
            await _db.LeadFieldConfigs
                .AsNoTracking()
                .Where(f => f.ProductId == productId)
                .OrderBy(f => f.DisplayOrder)
                .ToListAsync(ct);

        /// <summary>Same "after validation, before mutation" gate LeadService.cs's own
        /// TrySubmitForApprovalAsync uses, gated on the separate FieldSettingsModuleKey so Field
        /// Settings can be gated independently of Lead itself.</summary>
        private async Task<ApprovalPendingDto?> TrySubmitForApprovalAsync(
            Guid productId, string productName, string oldDataJson, object requestBody, Guid? actingUserId, bool bypassApproval, CancellationToken ct)
        {
            if (bypassApproval || actingUserId is null)
            {
                return null;
            }

            if (!await _authServiceClient.IsGatedAsync(_selfOptions.FieldSettingsModuleKey, ct))
            {
                return null;
            }

            var callbackUrl = $"{_selfOptions.PublicBaseUrl.TrimEnd('/')}/internal/approvals/apply";
            return await _authServiceClient.SubmitApprovalAsync(
                _selfOptions.FieldSettingsModuleKey, "Update", "LeadFieldConfig", productId.ToString(),
                $"{productName} Field Settings", oldDataJson, System.Text.Json.JsonSerializer.Serialize(requestBody),
                actingUserId.Value, callbackUrl, Guid.NewGuid().ToString(), ct);
        }

        public async Task<MutationResult<List<LeadFieldConfig>>> ReplaceAsync(
            Guid productId, List<LeadFieldConfig> incoming, Guid? actingUserId, string? actorName = null, bool bypassApproval = false, CancellationToken ct = default,
            string? expectedVersion = null)
        {
            var product = await _db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId, ct)
                ?? throw new InvalidOperationException($"Product '{productId}' was not found.");

            var existing = await _db.LeadFieldConfigs
                .Where(f => f.ProductId == productId)
                .ToDictionaryAsync(f => f.ApiField, StringComparer.OrdinalIgnoreCase, ct);
            var oldSnapshot = System.Text.Json.JsonSerializer.Serialize(existing.Values.ToList());

            // Two administrators editing the same product's settings: the second save used to silently
            // replace the first person's changes. A save based on an older version is refused instead.
            if (expectedVersion is not null && !string.Equals(expectedVersion, Fingerprint(existing.Values), StringComparison.Ordinal))
            {
                throw new StaleSettingsException();
            }

            // Checked before the approval gate, so a checker is never asked to approve a pattern that
            // cannot work — and again on replay, since replay comes back through here.
            EnsureRulesWellFormed(incoming);

            var pending = await TrySubmitForApprovalAsync(productId, product.Name, oldSnapshot, incoming, actingUserId, bypassApproval, ct);
            if (pending is not null)
            {
                return MutationResult<List<LeadFieldConfig>>.PendingApproval(pending);
            }

            foreach (var field in incoming)
            {
                if (!field.Sensitive)
                {
                    field.MaskingRule = "None";
                }

                if (existing.TryGetValue(field.ApiField, out var row))
                {
                    row.DisplayLabel = field.DisplayLabel;
                    row.Section = field.Section;
                    row.DisplayOrder = field.DisplayOrder;
                    row.Visible = field.Visible;
                    row.Required = field.Required;
                    row.Editable = field.Editable;
                    row.Sensitive = field.Sensitive;
                    row.MaskingRule = field.MaskingRule;
                    row.VisibleCharCount = field.VisibleCharCount;
                    // Copied on this branch AND the insert below. Leaving it off either would make an
                    // approved Field Settings change silently drop the field's formats on replay.
                    row.ValidationsJson = field.ValidationsJson;
                }
                else
                {
                    // Never delete — only update-in-place or insert, same as Customer360's own
                    // ReplaceAsync. A field the frontend doesn't send back just stays as-is.
                    _db.LeadFieldConfigs.Add(new LeadFieldConfig
                    {
                        Id = Guid.NewGuid(),
                        ProductId = productId,
                        ApiField = field.ApiField,
                        DisplayLabel = field.DisplayLabel,
                        Section = field.Section,
                        DisplayOrder = field.DisplayOrder,
                        Visible = field.Visible,
                        Required = field.Required,
                        Editable = field.Editable,
                        Sensitive = field.Sensitive,
                        MaskingRule = field.MaskingRule,
                        VisibleCharCount = field.VisibleCharCount,
                        ValidationsJson = field.ValidationsJson,
                    });
                }
            }

            await _db.SaveChangesAsync(ct);

            await _authServiceClient.PushAuditLogAsync(
                "leadfieldconfig.updated", "LeadFieldConfig", productId.ToString(),
                $"Updated Lead Management field settings for '{product.Name}'.", actingUserId, actorName, product.Name,
                module: "Field Settings", page: "field-settings", actionCategory: "Configuration", ct: ct);

            return MutationResult<List<LeadFieldConfig>>.Ok(await GetByProductAsync(productId, ct));
        }

        /// <summary>Thrown when Field Settings are saved against a version someone else has since replaced.</summary>
        public sealed class StaleSettingsException()
            : Exception("Someone else changed these field settings while you were editing. Reload to see their changes, then make yours again.");

        /// <summary>
        /// A short fingerprint of a product's field settings — the version the page loads (as an ETag) and saves
        /// against. Computed from the settings themselves, so it needs no version column and changes exactly when
        /// anything an administrator can edit changes.
        /// </summary>
        public static string Fingerprint(IEnumerable<LeadFieldConfig> rows)
        {
            var canonical = string.Join("\n", rows
                .OrderBy(r => r.ApiField, StringComparer.OrdinalIgnoreCase)
                .Select(r => string.Join("|", r.ApiField, r.DisplayLabel, r.Section, r.DisplayOrder, r.Visible, r.Required, r.Editable, r.Sensitive, r.MaskingRule, r.VisibleCharCount, r.ValidationsJson ?? string.Empty)));
            return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(canonical)))[..16].ToLowerInvariant();
        }

        /// <summary>Idempotent per ProductId — an existing product's config is never touched, so admin
        /// edits survive redeploys. Copies Customer360Service's runtime-seeder pattern rather than EF
        /// `HasData`, which would silently re-clobber intentional edits on every migration.</summary>
        public async Task EnsureSeededAsync(CancellationToken ct = default)
        {
            var products = await _db.Products.AsNoTracking().ToListAsync(ct);
            foreach (var product in products)
            {
                if (await _db.LeadFieldConfigs.AnyAsync(f => f.ProductId == product.Id, ct))
                {
                    continue;
                }

                _db.LeadFieldConfigs.AddRange(BuildDefaultsFor(product));
            }

            await _db.SaveChangesAsync(ct);
        }

        private static List<LeadFieldConfig> BuildDefaultsFor(Product product)
        {
            var rows = new List<(string ApiField, string Label, string Section, bool Required, bool Sensitive)>
            {
                ("customerName", "Customer Name", "Customer Information", true, false),
                ("icNumber", "IC Number", "Customer Information", true, true),
                ("phoneNumber", "Phone Number", "Customer Information", true, false),
                ("email", "Email", "Customer Information", true, false),
                ("state", "State", "Customer Information", true, false),
                ("branch", "Preferred Servicing Branch", "Customer Information", false, false),
                ("employerName", "Employer Name", "Employment & Financing", true, false),
                ("appliedAmount", "Applied Amount", "Employment & Financing", true, false),
                ("hasPreferredSalesExecutive", "Has Preferred Sales Executive", "Sales Executive Assignment", false, false),
                ("preferredSalesExecutive", "Preferred Sales Executive", "Sales Executive Assignment", false, false),
            };

            if (product.Name == "Home Financing")
            {
                rows.Add(("propertyType", "Property Type", "Product Details", true, false));
                rows.Add(("propertyStatus", "Property Status", "Product Details", true, false));
            }
            else if (product.Name == "Micro Finance")
            {
                rows.Add(("dateOfIncorporation", "Date of Incorporation", "Product Details", true, false));
                rows.Add(("companyName", "Company Name", "Product Details", true, false));
                rows.Add(("entityType", "Entity Type", "Product Details", true, false));
            }

            rows.Add(("marketingConsent", "Marketing Consent", "Declaration & Consent", true, false));
            rows.Add(("agreedToPrivacyPolicy", "Privacy Policy Agreement", "Declaration & Consent", true, false));

            var order = 0;
            return rows.Select(r => new LeadFieldConfig
            {
                Id = Guid.NewGuid(),
                ProductId = product.Id,
                ApiField = r.ApiField,
                DisplayLabel = r.Label,
                Section = r.Section,
                DisplayOrder = ++order,
                Visible = true,
                Required = r.Required,
                Editable = true,
                Sensitive = r.Sensitive,
                MaskingRule = r.Sensitive ? "HideFirstShowLast" : "None",
                VisibleCharCount = 4,
                Validations = DefaultRules(r.ApiField),
            }).ToList();
        }

        /// <summary>
        /// The formats a new product starts with — the checks that used to be hard-coded. Administrators
        /// change or remove them in Field Settings like any other rule. The same values are written to
        /// existing products by the <c>LeadFieldFormats</c> migration.
        /// </summary>
        public static List<LeadFieldRule> DefaultRules(string apiField) => apiField switch
        {
            "icNumber" =>
            [
                new LeadFieldRule
                {
                    Type = FieldPresets.Custom,
                    Pattern = "^[0-9]{6}-[0-9]{2}-[0-9]{4}$",
                    Message = "Please enter IC Number in format YYMMDD-PB-XXXX (e.g. 880512-14-5678).",
                },
            ],
            "phoneNumber" => [new LeadFieldRule { Type = FieldPresets.MobileIN, Message = "Please enter a valid phone number for the selected country." }],
            "email" => [new LeadFieldRule { Type = FieldPresets.EmailSmart, Message = "Please enter a valid email address." }],
            _ => [],
        };

        /// <summary>
        /// Refuses rules that cannot be evaluated as the administrator intends: no type, no message, a
        /// one-off pattern that is empty or does not compile, a length rule with no length.
        /// </summary>
        public static void EnsureRulesWellFormed(IEnumerable<LeadFieldConfig> fields)
        {
            var problems = new List<string>();
            foreach (var field in fields)
            {
                foreach (var rule in field.Validations)
                {
                    var label = string.IsNullOrWhiteSpace(field.DisplayLabel) ? field.ApiField : field.DisplayLabel;
                    if (string.IsNullOrWhiteSpace(rule.Message))
                    {
                        problems.Add($"{label}: every format needs the message people see when it is not met.");
                    }

                    if (rule.Type == FieldPresets.Custom)
                    {
                        if (string.IsNullOrWhiteSpace(rule.Pattern))
                        {
                            problems.Add($"{label}: the custom pattern is empty.");
                        }
                        else
                        {
                            try
                            {
                                _ = new System.Text.RegularExpressions.Regex(rule.Pattern, System.Text.RegularExpressions.RegexOptions.None, TimeSpan.FromMilliseconds(200));
                            }
                            catch (ArgumentException)
                            {
                                problems.Add($"{label}: \"{rule.Pattern}\" is not a valid pattern.");
                            }
                        }
                    }

                    if (rule.Type is FieldPresets.MinLength or FieldPresets.MaxLength or FieldPresets.ExactLength && rule.Value is not > 0)
                    {
                        problems.Add($"{label}: a length format needs a number of characters above zero.");
                    }
                }
            }

            if (problems.Count > 0)
            {
                throw new InvalidOperationException(string.Join(" ", problems));
            }
        }

        /// <summary>Lead form fields whose value is not in the format its Field Settings require.</summary>
        public sealed class FieldFormatException(IReadOnlyDictionary<string, string> errors)
            : InvalidOperationException(string.Join(" ", errors.Values))
        {
            /// <summary>Keyed by the form's own field name (e.g. "preferredBranch", not "branch").</summary>
            public IReadOnlyDictionary<string, string> Errors { get; } = errors;
        }

        /// <summary>
        /// Checks every configured format on a submitted lead. Throws <see cref="FieldFormatException"/>
        /// naming each field that fails.
        /// </summary>
        /// <param name="previous">On an edit, the lead as it is now. A value left unchanged is not
        /// re-checked: tightening a format later must not make every older lead impossible to edit
        /// until someone retypes a value nobody asked them to change.</param>
        public static void EnsureFormatsValid(
            List<LeadFieldConfig> fieldConfigs, CreateLeadDto dto, IReadOnlyList<FormatPreset> presets, LeadRecordDto? previous = null)
        {
            var index = FieldRuleEngine.Index(presets);
            var errors = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var field in fieldConfigs)
            {
                var rules = field.Validations;
                if (rules.Count == 0) continue;

                var value = GetFormatValue(dto, field.ApiField);
                if (string.IsNullOrWhiteSpace(value)) continue;

                if (previous is not null && ValuesMatch(field.ApiField, dto, previous)) continue;

                var message = FieldRuleEngine.FirstFailure(rules.Select(r => r.ToEngineRule()), value, index);
                if (message is not null)
                {
                    errors[FormFieldName(field.ApiField)] = message;
                }
            }

            if (errors.Count > 0)
            {
                throw new FieldFormatException(errors);
            }
        }

        /// <summary>The value a format is checked against — the phone number with its country code, as the form shows it.</summary>
        private static string? GetFormatValue(CreateLeadDto dto, string apiField) => apiField switch
        {
            "phoneNumber" => string.IsNullOrWhiteSpace(dto.PhoneNumber) ? null : ComposePhone(dto.PhoneCountryCode, dto.PhoneNumber),
            _ => GetDtoValue(dto, apiField),
        };

        /// <summary>
        /// "+60" and "12-345 6789" → "+60 12-345 6789". A number that already starts with its own country
        /// code (older records were saved that way, which is why lists showed "+60 +60 …") is not
        /// prefixed twice, or every such number would read as invalid.
        /// </summary>
        public static string ComposePhone(string? countryCode, string number)
        {
            var code = string.IsNullOrWhiteSpace(countryCode) ? string.Empty : countryCode.Trim();
            var national = number.Trim();
            while (code.Length > 0 && national.StartsWith(code, StringComparison.Ordinal))
            {
                national = national[code.Length..].TrimStart();
            }

            return $"{code} {national}".Trim();
        }

        public static string FormFieldName(string apiField) => apiField == "branch" ? "preferredBranch" : apiField;

        // ------------------------------------------------------------------------------------------
        // Backend enforcement — the mapping between the catalog's apiField string and the strongly
        // typed DTO/read-model properties is unavoidably fixed in C# (the same thing
        // DynamicProfileSection.tsx's resolveRawValue does dynamically via object indexing in
        // TypeScript). What's genuinely data-driven is WHICH fields exist for a product and whether
        // each is currently required/editable — never this name-to-property wiring itself.
        // ------------------------------------------------------------------------------------------

        /// <summary>Format validators (regex/email shape) on CreateLeadDto/UpdateLeadDto stay exactly
        /// as they were — this only adds "is this field mandatory AT ALL for this product", which used
        /// to be a blanket yes for every field regardless of product. Throws if anything configured
        /// Required is missing.</summary>
        public static void EnsureRequiredFieldsPresent(List<LeadFieldConfig> fieldConfigs, CreateLeadDto dto, string productName)
        {
            var missingLabels = new List<string>();
            foreach (var field in fieldConfigs.Where(f => f.Required))
            {
                if (field.ApiField == "agreedToPrivacyPolicy")
                {
                    if (!dto.AgreedToPrivacyPolicy) missingLabels.Add(field.DisplayLabel);
                    continue;
                }

                var value = GetDtoValue(dto, field.ApiField);
                // Null means "not a presence-checkable field" (e.g. hasPreferredSalesExecutive, a bool
                // flag with no empty state) — never treated as missing regardless of the Required flag.
                if (value is not null && string.IsNullOrWhiteSpace(value))
                {
                    missingLabels.Add(field.DisplayLabel);
                }
            }

            if (missingLabels.Count > 0)
            {
                throw new InvalidOperationException(
                    $"{string.Join(", ", missingLabels)} {(missingLabels.Count == 1 ? "is" : "are")} required for {productName}.");
            }
        }

        /// <summary>Compares the submitted value for every config-governed field against the lead's
        /// CURRENT value (from the already-fetched previousDto read-model) — a field marked
        /// Editable:false whose value actually changed is rejected. Values normalized before
        /// comparison where the DTO's raw shape differs from the read-model's formatted shape (phone,
        /// applied amount, branch's "Not Assigned" default) so formatting alone never produces a false
        /// positive.</summary>
        public static void EnsureEditableFieldsUnchanged(List<LeadFieldConfig> fieldConfigs, CreateLeadDto dto, LeadRecordDto previous)
        {
            var changedLabels = new List<string>();
            foreach (var field in fieldConfigs.Where(f => !f.Editable))
            {
                if (!ValuesMatch(field.ApiField, dto, previous))
                {
                    changedLabels.Add(field.DisplayLabel);
                }
            }

            if (changedLabels.Count > 0)
            {
                throw new InvalidOperationException(
                    $"{string.Join(", ", changedLabels)} cannot be changed for this product.");
            }
        }

        private static bool ValuesMatch(string apiField, CreateLeadDto dto, LeadRecordDto previous)
        {
            switch (apiField)
            {
                case "customerName":
                    return Norm(dto.CustomerName) == Norm(previous.Name);
                case "icNumber":
                    return Norm(dto.IcNumber) == Norm(previous.IcNumber);
                case "phoneNumber":
                    // previous.Phone is "{CountryCode} {Number}" combined — rebuild the same shape from
                    // the submitted DTO before comparing, or a same-number resubmission would look like
                    // a change purely from formatting.
                    var submittedPhone = $"{(string.IsNullOrWhiteSpace(dto.PhoneCountryCode) ? "+60" : dto.PhoneCountryCode)} {dto.PhoneNumber}".Trim();
                    return Norm(submittedPhone) == Norm(previous.Phone);
                case "email":
                    return Norm(dto.Email) == Norm(previous.Email);
                case "state":
                    return Norm(dto.State) == Norm(previous.State);
                case "branch":
                    // previous.Branch reads "Not Assigned" when no branch is set — an empty submitted
                    // value means the same thing, not a change.
                    var submittedBranch = string.IsNullOrWhiteSpace(dto.PreferredBranch) ? "Not Assigned" : dto.PreferredBranch;
                    return Norm(submittedBranch) == Norm(previous.Branch);
                case "employerName":
                    return Norm(dto.EmployerName) == Norm(previous.EmployerName);
                case "appliedAmount":
                    // previous.AppliedAmount is formatted ("50,000.00"); dto.AppliedAmount is raw
                    // ("50000" or "50,000") — compare as numbers, not strings.
                    var submittedParsed = decimal.TryParse(dto.AppliedAmount.Replace(",", "").Trim(), out var s) ? s : (decimal?)null;
                    var previousParsed = decimal.TryParse(previous.AppliedAmount.Replace(",", "").Trim(), out var p) ? p : (decimal?)null;
                    return submittedParsed == previousParsed;
                case "preferredSalesExecutive":
                    return Norm(dto.PreferredSalesExecutive) == Norm(previous.PreferredSalesExecutive);
                case "propertyType":
                    return Norm(dto.PropertyType) == Norm(previous.PropertyType);
                case "propertyStatus":
                    return Norm(dto.PropertyStatus) == Norm(previous.PropertyStatus);
                case "dateOfIncorporation":
                    return Norm(dto.DateOfIncorporation) == Norm(previous.DateOfIncorporation);
                case "companyName":
                    return Norm(dto.CompanyName) == Norm(previous.CompanyName);
                case "entityType":
                    return Norm(dto.EntityType) == Norm(previous.EntityType);
                case "marketingConsent":
                    return Norm(dto.MarketingConsent) == Norm(previous.MarketingConsent);
                // hasPreferredSalesExecutive: a bool flag, not present on the read-model in a directly
                // comparable form — skipped, mirrors GetDtoValue's "not presence-checkable" treatment.
                // agreedToPrivacyPolicy: not exposed on LeadRecordDto at all (no historical value to
                // compare against) — skipped; in practice this consent flag is not expected to ever be
                // marked non-editable.
                default:
                    return true;
            }
        }

        private static string Norm(string? value) => (value ?? string.Empty).Trim();

        /// <summary>Null return means "not a presence-checkable field" (e.g. a bool flag with no empty
        /// state) — the caller must never treat null as "missing".</summary>
        private static string? GetDtoValue(CreateLeadDto dto, string apiField) => apiField switch
        {
            "customerName" => dto.CustomerName,
            "icNumber" => dto.IcNumber,
            "phoneNumber" => dto.PhoneNumber,
            "email" => dto.Email,
            "state" => dto.State,
            "branch" => dto.PreferredBranch,
            "employerName" => dto.EmployerName,
            "appliedAmount" => dto.AppliedAmount,
            "preferredSalesExecutive" => dto.PreferredSalesExecutive,
            "propertyType" => dto.PropertyType,
            "propertyStatus" => dto.PropertyStatus,
            "dateOfIncorporation" => dto.DateOfIncorporation,
            "companyName" => dto.CompanyName,
            "entityType" => dto.EntityType,
            "marketingConsent" => dto.MarketingConsent,
            _ => null,
        };
    }
}
