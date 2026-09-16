using System.Diagnostics;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using LeadManagement.Api.Data;
using LeadManagement.Api.Models.Entities;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Infrastructure.Data;
using AuthAuditLog = AuthService.Domain.Entities.AuditLog;
using ProductApplication = ProductMarketplace.Domain.Entities.Application;
using ProductCategory = ProductMarketplace.Domain.Entities.Category;
using ProductEntity = ProductMarketplace.Domain.Entities.Product;
using ProductTypeEntity = ProductMarketplace.Domain.Entities.ProductType;

/*
 * OmniRemit load-test data tool.
 *
 *   dotnet run -- seed    --run <id> [--audit 100000] [--users 20000] [--leads 50000] [--applications 50000]
 *   dotnet run -- count   --run <id>
 *   dotnet run -- cleanup --run <id>
 *
 * The databases are shared with other developers, so EVERY generated row carries the run id and is
 * found again by it — nothing else is ever touched:
 *
 *   AuthDb     AuditLogs     ServiceName = "LoadTest", CorrelationId = "loadtest-<id>"
 *   AuthDb     Users         Email ends with "@<id>.loadtest.invalid" (Inactive, no password: cannot sign in)
 *   LeadDb     Leads         LeadReference starts with "LT-<id>-"
 *   Products   Category/Type/Product slug and code "loadtest-<id>", and every Application under that product
 *
 * Connection strings are read from each service's own .env file and never printed.
 */

var command = args.FirstOrDefault() ?? "help";
var options = ParseOptions(args.Skip(1).ToArray());
if (!options.TryGetValue("run", out var run) || !System.Text.RegularExpressions.Regex.IsMatch(run, "^[a-z0-9]{3,16}$"))
{
    Console.Error.WriteLine("usage: seed|count|cleanup --run <3-16 lowercase letters/digits> [--audit N] [--users N] [--leads N] [--applications N]");
    return 2;
}

var backend = FindBackendDirectory();
var tags = new Tags(run);

try
{
    switch (command)
    {
        case "seed":
            await SeedAuthAsync(backend, tags, Count(options, "audit", 100_000), Count(options, "users", 20_000));
            await SeedLeadsAsync(backend, tags, Count(options, "leads", 50_000));
            await SeedProductsAsync(backend, tags, Count(options, "applications", 50_000));
            await ReportCountsAsync(backend, tags);
            return 0;
        case "count":
            await ReportCountsAsync(backend, tags);
            return 0;
        case "cleanup":
            await CleanupAsync(backend, tags);
            var remaining = await ReportCountsAsync(backend, tags);
            Console.WriteLine(remaining == 0 ? "CLEANUP VERIFIED: 0 tagged rows remain." : $"CLEANUP INCOMPLETE: {remaining} tagged rows remain.");
            return remaining == 0 ? 0 : 1;
        default:
            Console.Error.WriteLine($"unknown command '{command}'");
            return 2;
    }
}
catch (Exception ex)
{
    // The message only — an Npgsql exception can embed connection details in its ToString().
    Console.Error.WriteLine($"FAILED: {ex.GetType().Name}: {ex.Message}");
    return 1;
}

// ---------------------------------------------------------------- seeding

static async Task SeedAuthAsync(string backend, Tags tags, int auditRows, int users)
{
    var actions = new[] { "user.created", "user.updated", "role.updated", "lead.created", "lead.updated", "page.viewed", "auth.login_succeeded", "auth.login_failed" };
    var modules = new[] { "Users", "Roles", "Lead Management", "Customer 360", "Products", "Dashboard" };
    var apps = new[] { "Host", "Lead Management", "Customer 360", "Products & Marketplace" };
    var rng = new Random(20260915);
    var now = DateTimeOffset.UtcNow;

    await BatchInsertAsync("AuthDb.AuditLogs", auditRows, () => AuthDb(backend), (db, from, to) =>
    {
        for (var i = from; i < to; i++)
        {
            var action = actions[rng.Next(actions.Length)];
            db.AuditLogs.Add(new AuthAuditLog
            {
                Id = Guid.NewGuid(),
                // Spread over the last 180 days so date-range filters and paging deep into history are exercised.
                OccurredAt = now.AddSeconds(-rng.Next(0, 180 * 24 * 3600)),
                ServiceName = Tags.AuditService,
                ActorUserId = null,
                ActorName = $"Load Actor {i % 500}",
                Action = action,
                EntityType = action.Split('.')[0],
                EntityId = (i % 5000).ToString(),
                EntityLabel = $"Load Record {i % 5000}",
                Result = action.EndsWith("failed") ? "Failure" : "Success",
                FailureReason = action.EndsWith("failed") ? "Invalid credentials" : null,
                CorrelationId = tags.Correlation,
                SourceApplication = apps[rng.Next(apps.Length)],
                HostOrRemote = "Host",
                Module = modules[rng.Next(modules.Length)],
                Page = "load-test",
                ActionCategory = action.StartsWith("page") ? "Navigation" : action.StartsWith("auth") ? "Auth" : "CRUD",
                SourceIp = $"10.{i % 250}.{i / 250 % 250}.1",
                UserAgent = "OmniRemit.LoadTest",
            });
        }
    });

    await BatchInsertAsync("AuthDb.Users", users, () => AuthDb(backend), (db, from, to) =>
    {
        for (var i = from; i < to; i++)
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                Name = $"Load User {i:000000}",
                Email = tags.UserEmail(i),
                PhoneNumber = $"+6012{i:0000000}",
                Status = UserStatus.Inactive,
                PasswordHash = null,
                AuthProvider = AuthProvider.Local,
                LastLoginAt = i % 3 == 0 ? null : now.AddMinutes(-i),
                CreatedAt = now,
                UpdatedAt = now,
            });
        }
    });
}

static async Task SeedLeadsAsync(string backend, Tags tags, int leads)
{
    Guid productId, stateId;
    await using (var probe = LeadDb(backend))
    {
        var product = await probe.Products.AsNoTracking().OrderBy(p => p.Id).Select(p => (Guid?)p.Id).FirstOrDefaultAsync();
        var state = await probe.States.AsNoTracking().OrderBy(s => s.Id).Select(s => (Guid?)s.Id).FirstOrDefaultAsync();
        if (product is null || state is null)
        {
            Console.WriteLine("LeadDb.Leads: skipped (no product/state master data to attach leads to).");
            return;
        }
        productId = product.Value;
        stateId = state.Value;
    }

    var statuses = new[] { "New", "Contacted", "Qualified", "Converted", "Lost" };
    var now = DateTime.UtcNow;
    await BatchInsertAsync("LeadDb.Leads", leads, () => LeadDb(backend), (db, from, to) =>
    {
        for (var i = from; i < to; i++)
        {
            db.Leads.Add(new Lead
            {
                LeadReference = tags.LeadReference(i),
                CustomerName = $"Load Customer {i:000000}",
                IcNumber = $"900101{i:000000}",
                PhoneCountryCode = "+60",
                PhoneNumber = $"12{i:0000000}",
                Email = $"lead{i}@{tags.Run}.loadtest.invalid",
                ProductId = productId,
                StateId = stateId,
                EmployerName = "Load Test Sdn Bhd",
                AppliedAmount = 10_000 + i % 90_000,
                Status = statuses[i % statuses.Length],
                CreatedAt = now.AddMinutes(-i),
                UpdatedAt = now.AddMinutes(-i),
            });
        }
    });
}

static async Task SeedProductsAsync(string backend, Tags tags, int applications)
{
    Guid productId;
    await using (var db = ProductsDb(backend))
    {
        var category = new ProductCategory { Name = $"LoadTest {tags.Run}", Slug = tags.Slug, Status = "Hidden" };
        var type = new ProductTypeEntity { Name = $"LoadTest {tags.Run}", Code = tags.Slug };
        var product = new ProductEntity { Name = $"LoadTest Product {tags.Run}", Code = tags.Slug, CategoryId = category.Id, ProductTypeId = type.Id, Status = "Hidden" };
        db.AddRange(category, type, product);
        await db.SaveChangesAsync();
        productId = product.Id;
    }

    var statuses = new[] { "Submitted", "UnderReview", "Approved", "Rejected", "DocumentsRequired", "Completed" };
    var now = DateTime.UtcNow;
    await BatchInsertAsync("Products.Applications", applications, () => ProductsDb(backend), (db, from, to) =>
    {
        for (var i = from; i < to; i++)
        {
            db.Applications.Add(new ProductApplication
            {
                ApplicationNumber = $"LT-{tags.Run}-{i:000000}",
                ProductId = productId,
                CustomerName = $"Load Applicant {i:000000}",
                Status = statuses[i % statuses.Length],
                CreatedAt = now.AddMinutes(-i),
                UpdatedAt = now.AddMinutes(-i),
            });
        }
    });
}

static async Task BatchInsertAsync<TContext>(string label, int total, Func<TContext> factory, Action<TContext, int, int> fill)
    where TContext : DbContext
{
    if (total <= 0) return;
    const int batch = 5_000;
    var clock = Stopwatch.StartNew();
    for (var from = 0; from < total; from += batch)
    {
        var to = Math.Min(from + batch, total);
        // A fresh context per batch keeps the change tracker small; detection is done once by Add.
        await using var db = factory();
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        fill(db, from, to);
        await db.SaveChangesAsync();
        Console.WriteLine($"{label}: {to:N0}/{total:N0} ({clock.Elapsed.TotalSeconds:N1}s)");
    }
    Console.WriteLine($"{label}: inserted {total:N0} rows in {clock.Elapsed.TotalSeconds:N1}s ({total / Math.Max(clock.Elapsed.TotalSeconds, 0.001):N0} rows/s)");
}

// ---------------------------------------------------------------- counting and cleanup

static async Task<long> ReportCountsAsync(string backend, Tags tags)
{
    long total = 0;
    await using (var auth = AuthDb(backend))
    {
        var audit = await auth.AuditLogs.LongCountAsync(a => a.ServiceName == Tags.AuditService && a.CorrelationId == tags.Correlation);
        var users = await auth.Users.IgnoreQueryFilters().LongCountAsync(u => u.Email.EndsWith(tags.UserEmailSuffix));
        var allAudit = await auth.AuditLogs.LongCountAsync();
        Console.WriteLine($"AuthDb.AuditLogs tagged: {audit:N0} (table total {allAudit:N0})");
        Console.WriteLine($"AuthDb.Users tagged:     {users:N0}");
        total += audit + users;
    }
    await using (var lead = LeadDb(backend))
    {
        var leads = await lead.Leads.LongCountAsync(l => l.LeadReference.StartsWith(tags.LeadPrefix));
        Console.WriteLine($"LeadDb.Leads tagged:     {leads:N0} (table total {await lead.Leads.LongCountAsync():N0})");
        total += leads;
    }
    await using (var products = ProductsDb(backend))
    {
        var apps = await products.Applications.LongCountAsync(a => a.Product.Code == tags.Slug);
        var catalog = await products.Products.LongCountAsync(p => p.Code == tags.Slug)
            + await products.Categories.LongCountAsync(c => c.Slug == tags.Slug)
            + await products.ProductTypes.LongCountAsync(t => t.Code == tags.Slug);
        Console.WriteLine($"Products.Applications tagged: {apps:N0} (+{catalog} catalog rows) (table total {await products.Applications.LongCountAsync():N0})");
        total += apps + catalog;
    }
    Console.WriteLine($"TOTAL tagged rows: {total:N0}");
    return total;
}

static async Task CleanupAsync(string backend, Tags tags)
{
    var clock = Stopwatch.StartNew();
    await using (var auth = AuthDb(backend))
    {
        auth.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        var audit = await auth.AuditLogs.Where(a => a.ServiceName == Tags.AuditService && a.CorrelationId == tags.Correlation).ExecuteDeleteAsync();
        Console.WriteLine($"AuthDb.AuditLogs deleted: {audit:N0}");
        var users = await auth.Users.IgnoreQueryFilters().Where(u => u.Email.EndsWith(tags.UserEmailSuffix)).ExecuteDeleteAsync();
        Console.WriteLine($"AuthDb.Users deleted:     {users:N0}");
    }
    await using (var lead = LeadDb(backend))
    {
        lead.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        var leads = await lead.Leads.Where(l => l.LeadReference.StartsWith(tags.LeadPrefix)).ExecuteDeleteAsync();
        Console.WriteLine($"LeadDb.Leads deleted:     {leads:N0}");
    }
    await using (var products = ProductsDb(backend))
    {
        products.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        var apps = await products.Applications.Where(a => a.Product.Code == tags.Slug).ExecuteDeleteAsync();
        var product = await products.Products.Where(p => p.Code == tags.Slug).ExecuteDeleteAsync();
        var type = await products.ProductTypes.Where(t => t.Code == tags.Slug).ExecuteDeleteAsync();
        var category = await products.Categories.Where(c => c.Slug == tags.Slug).ExecuteDeleteAsync();
        Console.WriteLine($"Products deleted: {apps:N0} applications, {product} product, {type} type, {category} category");
    }
    Console.WriteLine($"cleanup took {clock.Elapsed.TotalSeconds:N1}s");
}

// ---------------------------------------------------------------- configuration

static AuthDbContext AuthDb(string backend) =>
    new(new DbContextOptionsBuilder<AuthDbContext>().UseNpgsql(ConnectionString(backend, "AuthService", "ConnectionStrings__AuthDb"), o => o.CommandTimeout(300)).Options);

static ApplicationDbContext LeadDb(string backend) =>
    new(new DbContextOptionsBuilder<ApplicationDbContext>().UseNpgsql(ConnectionString(backend, "LeadService", "ConnectionStrings__LeadDb"), o => o.CommandTimeout(300)).Options);

static AppDbContext ProductsDb(string backend) =>
    new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(ConnectionString(backend, "ProductsService", "ConnectionStrings__DefaultConnection"), o => o.CommandTimeout(300)).Options);

static string ConnectionString(string backend, string service, string key)
{
    var path = Path.Combine(backend, service, ".env");
    if (!File.Exists(path)) throw new InvalidOperationException($"{service}/.env not found");
    foreach (var raw in File.ReadAllLines(path))
    {
        var line = raw.Trim();
        if (line.StartsWith('#') || !line.StartsWith(key + "=")) continue;
        var value = line[(key.Length + 1)..].Trim().Trim('"', '\'');
        if (value.Length > 0) return value;
    }
    throw new InvalidOperationException($"{key} is not set in {service}/.env");
}

static string FindBackendDirectory()
{
    for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
    {
        if (File.Exists(Path.Combine(dir.FullName, "OmniRemit.slnx"))) return dir.FullName;
    }
    throw new InvalidOperationException("Could not find the Backend folder (OmniRemit.slnx) above the tool.");
}

static Dictionary<string, string> ParseOptions(string[] args)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (var i = 0; i + 1 < args.Length; i += 2)
    {
        if (args[i].StartsWith("--")) result[args[i][2..]] = args[i + 1];
    }
    return result;
}

static int Count(Dictionary<string, string> options, string key, int fallback) =>
    options.TryGetValue(key, out var v) && int.TryParse(v, out var n) && n >= 0 ? Math.Min(n, 2_000_000) : fallback;

sealed record Tags(string Run)
{
    public const string AuditService = "LoadTest";
    public string Correlation => $"loadtest-{Run}";
    public string UserEmailSuffix => $"@{Run}.loadtest.invalid";
    public string UserEmail(int i) => $"load.user.{i:000000}{UserEmailSuffix}";
    public string LeadPrefix => $"LT-{Run}-";
    public string LeadReference(int i) => $"{LeadPrefix}{i:000000}";
    public string Slug => $"loadtest-{Run}";
}
