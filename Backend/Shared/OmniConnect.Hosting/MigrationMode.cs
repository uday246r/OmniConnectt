namespace OmniConnect.Hosting;

/// <summary>
/// <c>dotnet X.dll --migrate-only</c>: apply the database migrations, then exit — 0 on success, non-zero
/// on failure.
/// </summary>
/// <remarks>
/// <para>
/// Applying migrations from every instance on startup has two problems in production. Two replicas
/// starting together race to migrate one database. And each service swallows a migration failure on
/// startup (so <c>/health</c> can report it rather than the process crash-looping), which means a broken
/// migration does not stop a deploy — the new code simply starts against the old schema.
/// </para>
/// <para>
/// So the deployment runs each service's own image once in this mode, as a single writer, BEFORE
/// starting the new version, and stops if it fails; the services themselves run with
/// <c>Database:ApplyMigrationsOnStartup=false</c>. Same image, same migrations, no SDK on the server.
/// </para>
/// </remarks>
public static class MigrationMode
{
    public const string Flag = "--migrate-only";

    public static bool IsRequested(string[] args) => Array.IndexOf(args, Flag) >= 0;
}
