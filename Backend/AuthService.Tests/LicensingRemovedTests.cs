using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Proves the withdrawn licensing feature is actually gone, rather than gone from the places anyone
/// happened to look.
/// <para>
/// A removal spread across four services, two dozen files and a database is exactly the kind of
/// change that leaves something behind — an unused DTO, a dead config key, a stale mention in a
/// comment that later reads as a real design. Asserting it in a test means the answer stays true
/// after the next person touches this code, which a one-off manual sweep cannot.
/// </para>
/// </summary>
public class LicensingRemovedTests
{
    private static readonly string[] ForbiddenTerms =
    [
        "entitlement", "licensing", "unlicensed", "moduleentitlement",
        "planTier", "lockReason", "not-entitled",
    ];

    /// <summary>
    /// Applied migrations are deliberately exempt. Deleting one from disk would leave the table in
    /// the database with an untracked history row — the very orphan this removal set out to avoid —
    /// so the historical migration stays and a later one drops the table.
    /// </summary>
    private static bool IsExempt(string path)
    {
        var normalised = path.Replace('\\', '/');
        return normalised.Contains("/Migrations/")
            || normalised.Contains("/obj/")
            || normalised.Contains("/bin/")
            || normalised.Contains("/node_modules/")
            || normalised.Contains("/dist/")
            // Its entire job is deleting the rows licensing left behind, so naming it is the point.
            // Exempted by name rather than by folder, so a reintroduction elsewhere in Seed/ still fails.
            || normalised.EndsWith("LegacyFeatureCleanup.cs", StringComparison.Ordinal)
            || normalised.EndsWith("LicensingRemovedTests.cs", StringComparison.Ordinal);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "Backend")))
        {
            dir = dir.Parent;
        }
        Assert.NotNull(dir);
        return dir!.FullName;
    }

    public static TheoryData<string> SourceRoots() => new()
    {
        "Backend",
        Path.Combine("Frontend", "apps"),
        Path.Combine("Frontend", "packages"),
    };

    [Theory]
    [MemberData(nameof(SourceRoots))]
    public void No_source_file_mentions_licensing(string relativeRoot)
    {
        var root = Path.Combine(RepoRoot(), relativeRoot);
        Assert.True(Directory.Exists(root), $"Expected source root not found: {root}");

        var extensions = new[] { ".cs", ".ts", ".tsx", ".css", ".json" };

        var offenders = Directory
            .EnumerateFiles(root, "*.*", SearchOption.AllDirectories)
            .Where(f => extensions.Contains(Path.GetExtension(f), StringComparer.OrdinalIgnoreCase))
            .Where(f => !IsExempt(f))
            .Select(f => (File: f, Text: File.ReadAllText(f)))
            .Where(x => ForbiddenTerms.Any(t => x.Text.Contains(t, StringComparison.OrdinalIgnoreCase)))
            .Select(x => Path.GetRelativePath(RepoRoot(), x.File))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "Licensing was withdrawn, but these files still reference it:\n  " + string.Join("\n  ", offenders));
    }

    [Fact]
    public void The_auth_database_no_longer_defines_an_entitlement_set()
    {
        // Reflection rather than a text search: this asserts the model itself, so a DbSet reintroduced
        // under a different name but the same type would still be caught.
        var properties = typeof(AuthService.Infrastructure.AuthDbContext).GetProperties();

        Assert.DoesNotContain(properties, p =>
            p.PropertyType.IsGenericType &&
            p.PropertyType.GetGenericArguments()[0].Name.Contains("Entitlement", StringComparison.OrdinalIgnoreCase));
    }
}
