using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LeadManagement.Api.Models.Entities
{
    /// <summary>
    /// One field's presentation/validation rule for one Marketplace sub-category — label, visibility, whether it's
    /// mandatory, whether it can be edited after creation, ordering, and masking for sensitive values.
    /// This is config over the fields that already exist in code (see LeadFieldConfigService's own
    /// doc comment for the fixed catalog) — never a schema/EAV mechanism for inventing new data
    /// columns. A separate implementation from Customer360Service's FieldConfig, deliberately not
    /// shared, since Lead's fields are keyed by a real Product row rather than a fixed profile-type
    /// enum, and Lead's forms need real input controls, not just masked read-only display.
    /// </summary>
    [Table("LeadFieldConfigs")]
    public class LeadFieldConfig
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        /// <summary>
        /// The Marketplace sub-category this configuration is for, so every product of one type ("Home
        /// Loan – Salaried", "Home Loan – Self employed") shares the same lead form. A reference into
        /// another service's data, so it has no foreign key.
        /// </summary>
        [Required]
        public Guid CatalogSubCategoryId { get; set; }

        /// <summary>The fixed catalog key — e.g. "customerName", "propertyType". Matched by name
        /// against CreateLeadDto/UpdateLeadDto/Lead properties in LeadFieldConfigService's own
        /// GetFieldValue/GetCurrentValue switch — see that file's doc comment for the full catalog.</summary>
        [Required]
        [MaxLength(150)]
        public string ApiField { get; set; } = string.Empty;

        [Required]
        [MaxLength(200)]
        public string DisplayLabel { get; set; } = string.Empty;

        [Required]
        [MaxLength(150)]
        public string Section { get; set; } = string.Empty;

        public int DisplayOrder { get; set; }

        public bool Visible { get; set; } = true;

        /// <summary>Enforced server-side in LeadFieldConfigService's required-field check on
        /// Create/Update — not just a frontend asterisk.</summary>
        public bool Required { get; set; }

        /// <summary>Enforced server-side on Update — a changed value for a field with Editable=false
        /// is rejected, not just disabled in the UI.</summary>
        public bool Editable { get; set; } = true;

        public bool Sensitive { get; set; }

        /// <summary>One of "None", "HideFirstShowLast", "HideLastShowFirst",
        /// "HideMiddleShowFirstAndLast", "FullMask" — a plain string, not an enum, matching this
        /// service's own convention (Lead.Status is likewise a free string, no enum used anywhere in
        /// LeadService's models). Forced back to "None" whenever Sensitive is false.</summary>
        [Required]
        [MaxLength(40)]
        public string MaskingRule { get; set; } = "None";

        public int VisibleCharCount { get; set; } = 4;

        /// <summary>
        /// The field's format rules, as JSON — the same rule shape user fields use in Manage Fields: a
        /// built-in preset ("emailSmart", "mobileIN", "minLength" with a value), a format an
        /// administrator defined in Settings → Manage Formats (by its key), or a one-off pattern.
        /// </summary>
        /// <remarks>
        /// Stored rather than coded so a format is an administrator's decision. The IC number, phone and
        /// email checks used to be regexes typed into CreateLeadDto and three places in the form store,
        /// which nobody could change without a release and which approval replay never re-ran.
        /// </remarks>
        [Column(TypeName = "jsonb")]
        [JsonIgnore]
        public string? ValidationsJson { get; set; }

        [NotMapped]
        public List<LeadFieldRule> Validations
        {
            get => LeadFieldRule.Parse(ValidationsJson);
            set => ValidationsJson = value is { Count: > 0 } ? JsonSerializer.Serialize(value, LeadFieldRule.JsonOptions) : null;
        }
    }

    /// <summary>One format rule on a lead field. Same shape as a user field's rule, so one engine evaluates both.</summary>
    public sealed class LeadFieldRule
    {
        public string Type { get; set; } = string.Empty;
        public string? Pattern { get; set; }
        public int? Value { get; set; }
        public string Message { get; set; } = string.Empty;

        internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

        /// <summary>A malformed stored value reads as "no rules" — a bad row must not stop anyone creating leads.</summary>
        public static List<LeadFieldRule> Parse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return [];
            try
            {
                return (JsonSerializer.Deserialize<List<LeadFieldRule>>(json, JsonOptions) ?? [])
                    .Where(r => !string.IsNullOrWhiteSpace(r.Type))
                    .ToList();
            }
            catch (JsonException)
            {
                return [];
            }
        }

        public OmniConnect.Validation.FieldRule ToEngineRule() => new(Type, Pattern, Value, Message);
    }
}
