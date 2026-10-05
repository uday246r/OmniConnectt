using Microsoft.EntityFrameworkCore;
using LeadManagement.Api.Models.Entities;

namespace LeadManagement.Api.Data
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
            : base(options)
        {
        }

        public DbSet<State> States { get; set; }
        public DbSet<Branch> Branches { get; set; }
        public DbSet<SalesExecutive> SalesExecutives { get; set; }
        public DbSet<PropertyTypeLookup> PropertyTypes { get; set; }
        public DbSet<PropertyStatusLookup> PropertyStatuses { get; set; }
        public DbSet<EntityTypeLookup> EntityTypes { get; set; }
        public DbSet<LeadFieldConfig> LeadFieldConfigs { get; set; }
        public DbSet<Lead> Leads { get; set; }
        public DbSet<LeadHomeFinancingDetail> LeadHomeFinancingDetails { get; set; }
        public DbSet<LeadMicrofinanceDetail> LeadMicrofinanceDetails { get; set; }
        public DbSet<LeadConsentDetail> LeadConsentDetails { get; set; }
        public DbSet<AuditLog> AuditLogs { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Indexes
            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.CreatedAt);

            /*
             * The shape every lead list request actually has.
             *
             * GetLeadsAsync opens with `.Where(l => !l.IsDeleted)` and closes with
             * `.OrderByDescending(l => l.CreatedAt)` on EVERY call, whatever else it filters on in
             * between. The CreatedAt-only index above cannot serve that: Postgres still has to filter
             * the soft-deleted rows out after reading the index, and the proportion of dead rows only
             * grows over time.
             *
             * Descending on CreatedAt so the index order matches the sort direction and no separate
             * sort step is needed.
             */
            modelBuilder.Entity<Lead>()
                .HasIndex(l => new { l.IsDeleted, l.CreatedAt })
                .IsDescending(false, true);

            // Filtered by the list's status facet, and previously unindexed.
            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.Status);

            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.CustomerName);

            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.IcNumber);

            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.Timestamp);

            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.ActionType);

            modelBuilder.Entity<AuditLog>()
                .HasIndex(a => a.EntityId);

            // One config row per (Marketplace sub-category, ApiField) — same uniqueness guarantee
            // Customer360Service's field_configs table has on (ProfileType, ApiField). No foreign key: the
            // sub-category lives in ProductsService's database.
            modelBuilder.Entity<LeadFieldConfig>()
                .HasIndex(f => new { f.CatalogSubCategoryId, f.ApiField })
                .IsUnique();

            // The product a lead is for is filtered and grouped by on the list and the dashboard.
            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.ProductName);

            modelBuilder.Entity<Lead>()
                .HasIndex(l => l.CatalogProductId);

            // Seed Master Data
            SeedMasterData(modelBuilder);
        }

        private static void SeedMasterData(ModelBuilder modelBuilder)
        {
            // Products are not master data here any more: they come from the Marketplace (ProductsService).

            // States
            var stateKlId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
            var stateSelId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
            var stateJohorId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
            var statePenangId = Guid.Parse("a0000000-0000-0000-0000-000000000004");
            var statePerakId = Guid.Parse("a0000000-0000-0000-0000-000000000005");
            var stateKedahId = Guid.Parse("a0000000-0000-0000-0000-000000000006");
            var stateMelakaId = Guid.Parse("a0000000-0000-0000-0000-000000000007");
            var stateNsemId = Guid.Parse("a0000000-0000-0000-0000-000000000008");
            var statePahangId = Guid.Parse("a0000000-0000-0000-0000-000000000009");
            var stateKelantanId = Guid.Parse("a0000000-0000-0000-0000-000000000010");
            var stateSarawakId = Guid.Parse("a0000000-0000-0000-0000-000000000011");
            var stateSabahId = Guid.Parse("a0000000-0000-0000-0000-000000000012");
            var stateTerengganuId = Guid.Parse("a0000000-0000-0000-0000-000000000013");

            var states = new List<State>
            {
                new State { Id = stateKlId, Code = "KUL", Name = "KUALA LUMPUR" },
                new State { Id = stateSelId, Code = "SGL", Name = "SELANGOR" },
                new State { Id = stateJohorId, Code = "JHR", Name = "JOHOR" },
                new State { Id = statePenangId, Code = "PNG", Name = "PULAU PINANG" },
                new State { Id = statePerakId, Code = "PRK", Name = "PERAK" },
                new State { Id = stateKedahId, Code = "KDH", Name = "KEDAH" },
                new State { Id = stateMelakaId, Code = "MLK", Name = "MELAKA" },
                new State { Id = stateNsemId, Code = "NSN", Name = "N.SEMBILAN" },
                new State { Id = statePahangId, Code = "PHG", Name = "PAHANG" },
                new State { Id = stateKelantanId, Code = "KTN", Name = "KELANTAN" },
                new State { Id = stateSarawakId, Code = "SWK", Name = "SARAWAK" },
                new State { Id = stateSabahId, Code = "SBH", Name = "SABAH" },
                new State { Id = stateTerengganuId, Code = "TRG", Name = "TERENGGANU" }
            };
            modelBuilder.Entity<State>().HasData(states);

            // Branches
            var branches = new List<Branch>
            {
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000001"), StateId = stateKlId, Code = "KL01", Name = "Kuala Lumpur Main Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000002"), StateId = stateKlId, Code = "KL02", Name = "Bangsar Financial Centre" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000003"), StateId = stateSelId, Code = "SL01", Name = "Shah Alam Central Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000004"), StateId = stateSelId, Code = "SL02", Name = "Petaling Jaya Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000005"), StateId = stateJohorId, Code = "JH01", Name = "Johor Bahru Main Hub" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000006"), StateId = statePenangId, Code = "PN01", Name = "Georgetown Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000007"), StateId = statePerakId, Code = "PK01", Name = "Ipoh Central Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000008"), StateId = stateKedahId, Code = "KD01", Name = "Alor Setar Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000009"), StateId = stateMelakaId, Code = "MK01", Name = "Melaka Raya Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000010"), StateId = stateNsemId, Code = "NS01", Name = "Seremban Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000011"), StateId = statePahangId, Code = "PH01", Name = "Kuantan Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000012"), StateId = stateKelantanId, Code = "KT01", Name = "Kota Bharu Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000013"), StateId = stateSarawakId, Code = "SK01", Name = "Kuching Main Branch" },
                new Branch { Id = Guid.Parse("b0000000-0000-0000-0000-000000000014"), StateId = stateSabahId, Code = "SB01", Name = "Kota Kinabalu Branch" }
            };
            modelBuilder.Entity<Branch>().HasData(branches);

            // Sales Executives
            var salesExecutives = new List<SalesExecutive>
            {
                new SalesExecutive { Id = Guid.Parse("c0000000-0000-0000-0000-000000000001"), StaffId = "SE-1001", Name = "Azman bin Ibrahim (Staff ID: SE-1001)", Email = "azman.ibrahim@bank.com" },
                new SalesExecutive { Id = Guid.Parse("c0000000-0000-0000-0000-000000000002"), StaffId = "SE-1002", Name = "Noraini binti Razak (Staff ID: SE-1002)", Email = "noraini.razak@bank.com" },
                new SalesExecutive { Id = Guid.Parse("c0000000-0000-0000-0000-000000000003"), StaffId = "SE-1003", Name = "Kevin Tan (Staff ID: SE-1003)", Email = "kevin.tan@bank.com" },
                new SalesExecutive { Id = Guid.Parse("c0000000-0000-0000-0000-000000000004"), StaffId = "SE-1004", Name = "Saraswathy a/p Ramasamy (Staff ID: SE-1004)", Email = "saraswathy.r@bank.com" }
            };
            modelBuilder.Entity<SalesExecutive>().HasData(salesExecutives);

            // Property Types
            var propertyTypes = new List<PropertyTypeLookup>
            {
                new PropertyTypeLookup { Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"), Name = "Apartment" },
                new PropertyTypeLookup { Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"), Name = "Bungalow" },
                new PropertyTypeLookup { Id = Guid.Parse("d0000000-0000-0000-0000-000000000003"), Name = "Condominium" },
                new PropertyTypeLookup { Id = Guid.Parse("d0000000-0000-0000-0000-000000000004"), Name = "Terrace" }
            };
            modelBuilder.Entity<PropertyTypeLookup>().HasData(propertyTypes);

            // Property Statuses
            var propertyStatuses = new List<PropertyStatusLookup>
            {
                new PropertyStatusLookup { Id = Guid.Parse("e0000000-0000-0000-0000-000000000001"), Name = "Completed" },
                new PropertyStatusLookup { Id = Guid.Parse("e0000000-0000-0000-0000-000000000002"), Name = "Under Construction" }
            };
            modelBuilder.Entity<PropertyStatusLookup>().HasData(propertyStatuses);

            // Entity Types
            var entityTypes = new List<EntityTypeLookup>
            {
                new EntityTypeLookup { Id = Guid.Parse("f0000000-0000-0000-0000-000000000001"), Name = "Business with SSM" },
                new EntityTypeLookup { Id = Guid.Parse("f0000000-0000-0000-0000-000000000002"), Name = "Professional Body" },
                new EntityTypeLookup { Id = Guid.Parse("f0000000-0000-0000-0000-000000000003"), Name = "Sabah Sarawak Registration" }
            };
            modelBuilder.Entity<EntityTypeLookup>().HasData(entityTypes);
        }
    }
}
