using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LeadManagement.Api.Models.Entities
{
    [Table("Leads")]
    public class Lead
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(50)]
        public string LeadReference { get; set; } = string.Empty;

        [Required]
        [MaxLength(200)]
        public string CustomerName { get; set; } = string.Empty;

        [Required]
        [MaxLength(30)]
        public string IcNumber { get; set; } = string.Empty;

        [Required]
        [MaxLength(10)]
        public string PhoneCountryCode { get; set; } = "+60";

        [Required]
        [MaxLength(30)]
        public string PhoneNumber { get; set; } = string.Empty;

        [Required]
        [MaxLength(200)]
        public string Email { get; set; } = string.Empty;

        /*
         * The product this lead is for, by reference into the Marketplace (ProductsService) — and a
         * snapshot of what it was called when the lead was taken.
         *
         * There is no foreign key: the catalogue lives in another service's database. The snapshot is what
         * every list, export and dashboard reads, so renaming a product, moving it to another category or
         * withdrawing it never rewrites history. CatalogProductId is null only for a lead taken before
         * the catalogue was connected; it keeps the product name it had.
         */
        public Guid? CatalogProductId { get; set; }

        [Required]
        [MaxLength(200)]
        public string ProductName { get; set; } = string.Empty;

        [MaxLength(100)]
        public string ProductCode { get; set; } = string.Empty;

        /// <summary>The sub-category the product sat under: what decides which lead fields apply (LeadFieldConfig).</summary>
        public Guid? CatalogSubCategoryId { get; set; }

        [MaxLength(200)]
        public string SubCategoryName { get; set; } = string.Empty;

        [MaxLength(100)]
        public string SubCategoryCode { get; set; } = string.Empty;

        public Guid? CatalogCategoryId { get; set; }

        [MaxLength(200)]
        public string CategoryName { get; set; } = string.Empty;

        [MaxLength(100)]
        public string CategoryCode { get; set; } = string.Empty;

        [Required]
        public Guid StateId { get; set; }

        [ForeignKey(nameof(StateId))]
        public State? State { get; set; }

        public Guid? BranchId { get; set; }

        [ForeignKey(nameof(BranchId))]
        public Branch? Branch { get; set; }

        [Required]
        [MaxLength(200)]
        public string EmployerName { get; set; } = string.Empty;

        [Required]
        [Column(TypeName = "decimal(18, 2)")]
        public decimal AppliedAmount { get; set; }

        public bool HasPreferredSalesExecutive { get; set; } = false;

        public Guid? PreferredSalesExecutiveId { get; set; }

        [ForeignKey(nameof(PreferredSalesExecutiveId))]
        public SalesExecutive? PreferredSalesExecutive { get; set; }

        [Required]
        [MaxLength(50)]
        public string Status { get; set; } = "New";

        public bool IsDeleted { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation Properties for product details & consents
        public LeadHomeFinancingDetail? HomeFinancingDetail { get; set; }
        public LeadMicrofinanceDetail? MicrofinanceDetail { get; set; }
        public LeadConsentDetail? ConsentDetail { get; set; }
    }

    [Table("LeadHomeFinancingDetails")]
    public class LeadHomeFinancingDetail
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid LeadId { get; set; }

        [ForeignKey(nameof(LeadId))]
        public Lead? Lead { get; set; }

        [Required]
        [MaxLength(100)]
        public string PropertyType { get; set; } = string.Empty;

        [Required]
        [MaxLength(100)]
        public string PropertyStatus { get; set; } = string.Empty;
    }

    [Table("LeadMicrofinanceDetails")]
    public class LeadMicrofinanceDetail
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid LeadId { get; set; }

        [ForeignKey(nameof(LeadId))]
        public Lead? Lead { get; set; }

        [Required]
        [MaxLength(50)]
        public string DateOfIncorporation { get; set; } = string.Empty;

        [Required]
        [MaxLength(200)]
        public string CompanyName { get; set; } = string.Empty;

        [Required]
        [MaxLength(100)]
        public string EntityType { get; set; } = string.Empty;
    }

    [Table("LeadConsentDetails")]
    public class LeadConsentDetail
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public Guid LeadId { get; set; }

        [ForeignKey(nameof(LeadId))]
        public Lead? Lead { get; set; }

        [Required]
        [MaxLength(50)]
        public string MarketingConsent { get; set; } = string.Empty;

        public bool AgreedToPrivacyPolicy { get; set; } = true;

        public DateTime ConsentedAt { get; set; } = DateTime.UtcNow;
    }
}
