using System.ComponentModel.DataAnnotations;

namespace LeadManagement.Api.Models.Dtos
{
    public class DropdownOptionDto
    {
        public string Value { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string? Description { get; set; }
    }

    /// <summary>The real Product row (Id + Name) — unlike DropdownOptionDto's Products shape (Value=Name,
    /// Label=Name, no id), needed by Field Settings since LeadFieldConfig is keyed by the actual
    /// Product Guid, not by name.</summary>
    public class ProductWithIdDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }

    public class ReferenceDataDto
    {
        public List<DropdownOptionDto> PropertyTypes { get; set; } = new();
        public List<DropdownOptionDto> PropertyStatuses { get; set; } = new();
        public List<DropdownOptionDto> EntityTypes { get; set; } = new();
    }

    public class CreateLeadDto
    {
        // Product selection is a structural requirement (the field config below is KEYED by product,
        // so there's no such thing as "no product"), not a catalog field an admin can make optional —
        // this is the one field on this DTO that keeps a static [Required].
        [Required(ErrorMessage = "Product selection is required.")]
        public string Product { get; set; } = string.Empty;

        // Every other field below is governed by LeadFieldConfig's per-product Required flag
        // (LeadFieldConfigService's required-field check, run in the service layer) instead of a
        // static DataAnnotation — a blanket [Required] here would reject an empty value at model
        // binding before that config-driven check ever ran, making "Required: false" for a given
        // product silently ineffective. Format validators (regex/email shape) stay: they no-op on a
        // null/empty value by ASP.NET Core convention, so they don't fight the config-driven presence
        // check — they only ever apply once a value IS present.
        public string CustomerName { get; set; } = string.Empty;

        [RegularExpression(@"^\d{6}-\d{2}-\d{4}$", ErrorMessage = "Please enter IC Number in format YYMMDD-PB-XXXX (e.g. 880512-14-5678).")]
        public string IcNumber { get; set; } = string.Empty;

        /// <summary>Defaults to Malaysia, but no longer constrains what the number may be.</summary>
        public string PhoneCountryCode { get; set; } = "+60";

        /*
         * Widened from a Malaysia-only pattern to a general digit-count rule.
         *
         * The old regex accepted only +60 numbers, while the platform's shared validator
         * (Frontend/packages/ui/src/validation/phone.ts) supports 35 countries and AuthService accepts
         * any 7-15 digits. A lead for a Singaporean or Indian customer was therefore valid in the UI
         * and in AuthService, and rejected here — the same number judged three different ways.
         *
         * The precise per-country digit ranges live in the shared frontend validator, which knows
         * which country was actually selected. This server-side rule is the backstop: it enforces the
         * shape and a sane length without pretending to know the country from the number alone.
         */
        [RegularExpression(@"^(?=(?:\D*\d){7,15}\D*$)[0-9+()\-.\s]+$", ErrorMessage = "Enter a valid phone number (7-15 digits).")]
        public string PhoneNumber { get; set; } = string.Empty;

        [EmailAddress(ErrorMessage = "Please enter a valid email address.")]
        public string Email { get; set; } = string.Empty;

        public string State { get; set; } = string.Empty;

        public string PreferredBranch { get; set; } = string.Empty;

        public string EmployerName { get; set; } = string.Empty;

        public string AppliedAmount { get; set; } = string.Empty;

        public bool HasPreferredSalesExecutive { get; set; } = false;

        public string PreferredSalesExecutive { get; set; } = string.Empty;

        // Product specific fields
        public string PropertyType { get; set; } = string.Empty;
        public string PropertyStatus { get; set; } = string.Empty;
        public string DateOfIncorporation { get; set; } = string.Empty;
        public string CompanyName { get; set; } = string.Empty;
        public string EntityType { get; set; } = string.Empty;

        // Consent
        public string MarketingConsent { get; set; } = string.Empty;

        public bool AgreedToPrivacyPolicy { get; set; }
    }

    public class UpdateLeadDto : CreateLeadDto
    {
        [Required(ErrorMessage = "Edit reason is required.")]
        public string EditReason { get; set; } = string.Empty;
    }

    public class DeleteLeadDto
    {
        [Required(ErrorMessage = "Delete reason is required.")]
        public string DeleteReason { get; set; } = string.Empty;
    }

    public class LeadRecordDto
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string IcNumber { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Product { get; set; } = string.Empty;
        public string State { get; set; } = string.Empty;
        public string Branch { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string CreatedDate { get; set; } = string.Empty;
        public string EmployerName { get; set; } = string.Empty;
        public string AppliedAmount { get; set; } = string.Empty;
        public string? PreferredSalesExecutive { get; set; }
        public string? PropertyType { get; set; }
        public string? PropertyStatus { get; set; }
        public string? DateOfIncorporation { get; set; }
        public string? CompanyName { get; set; }
        public string? EntityType { get; set; }
        public string? MarketingConsent { get; set; }
    }

    public class PagedResultDto<T>
    {
        public List<T> Items { get; set; } = new();
        public int TotalRecords { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalPages { get; set; }
    }

    public class ApiResponseDto<T>
    {
        public bool Success { get; set; }
        public T? Data { get; set; }
        public string? Message { get; set; }
        public Dictionary<string, string>? Errors { get; set; }
    }
}
