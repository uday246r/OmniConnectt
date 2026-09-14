using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <summary>
    /// Turns <c>audit_logs."Timestamp"</c> from local wall-clock TEXT into a real UTC instant, and
    /// adds the actor's user id alongside the display name already stored.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The column held <c>DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")</c> — the application server's
    /// LOCAL clock, with the offset discarded — and rows were ordered by sorting that text. It looked
    /// correct because <c>yyyy-MM-dd HH:mm:ss</c> happens to sort lexicographically in chronological
    /// order, but only for rows written in one fixed offset. It also made a date-range query
    /// inexpressible, which is why this service's audit API was the only log surface on the platform
    /// with no date filter at all.
    /// </para>
    /// <para>
    /// <b>The original offset is not recoverable from the data.</b> Nothing in the row records which
    /// zone the writer was in, so the backfill has to assume one; <see cref="LegacyTimestampZone"/>
    /// is that assumption, stated in one place rather than buried in a SQL string. If a deployment's
    /// application servers ran in a zone other than the one named there — or spanned two, which no
    /// single value can fix — change it before applying this migration, because afterwards the
    /// evidence needed to correct it is gone.
    /// </para>
    /// <para>
    /// For a production cutover with real history at stake, the safer shape is additive: add a new
    /// nullable instant column, dual-write both for a release, verify the backfill per environment,
    /// then drop the text column in a second migration. That is deliberately not what this does —
    /// this database's audit history is development data, and the extra release cycle buys nothing
    /// here. The additive path is the one to reach for if that ever stops being true.
    /// </para>
    /// </remarks>
    public partial class AuditLogTimestampToUtcInstant : Migration
    {
        /// <summary>
        /// The zone the legacy text timestamps are assumed to have been written in. An IANA name, not
        /// a fixed offset, so Postgres applies the DST rules that were in force at each row's own
        /// instant rather than today's.
        /// </summary>
        private const string LegacyTimestampZone = "UTC";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /*
             * Explicit USING, because Postgres has no implicit text -> timestamptz cast and EF's
             * generated AlterColumn would fail outright on a non-empty table.
             *
             * The CASE is not defensive padding. A value that does not match the exact shape the
             * writer produced would abort the whole migration on the cast, so the regex guard sends
             * it to -infinity instead: an instant that is unmistakably not real, sorts last under the
             * newest-first ordering these rows are always read in, and leaves the anomaly visible
             * rather than converting it into a plausible-looking wrong date.
             *
             * `::timestamp` reads the text as a wall-clock reading with no zone; `AT TIME ZONE` then
             * says which zone that reading was taken in and yields the instant. Doing it in the other
             * order would relabel the instant instead of interpreting it.
             */
            migrationBuilder.Sql($$"""
                ALTER TABLE audit_logs
                ALTER COLUMN "Timestamp" TYPE timestamp with time zone
                USING (
                    CASE
                        WHEN "Timestamp" ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
                            THEN ("Timestamp"::timestamp AT TIME ZONE '{{LegacyTimestampZone}}')
                        ELSE '-infinity'::timestamptz
                    END
                );
                """);

            migrationBuilder.AddColumn<Guid>(
                name: "UserId",
                table: "audit_logs",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserId",
                table: "audit_logs");

            // Renders back into the original local-wall-clock text so the previous binary can read
            // the table. Rows written after the Up migration are converted out of UTC into the same
            // assumed zone, which round-trips them; rows that were -infinity cannot be represented at
            // all and become the epoch, which is the closest honest answer available going backwards.
            migrationBuilder.Sql($$"""
                ALTER TABLE audit_logs
                ALTER COLUMN "Timestamp" TYPE text
                USING (
                    CASE
                        WHEN "Timestamp" = '-infinity'::timestamptz THEN '1970-01-01 00:00:00'
                        ELSE to_char("Timestamp" AT TIME ZONE '{{LegacyTimestampZone}}', 'YYYY-MM-DD HH24:MI:SS')
                    END
                );
                """);
        }
    }
}
