using System.Text;

namespace LeadManagement.Api.Models.Dtos;

/// <summary>
/// A generated CSV, plus what the caller needs to know about what was left out of it.
/// </summary>
/// <remarks>
/// <para>
/// Every export on this platform caps its row count, which is right — an unbounded export of an
/// audit table is a cheap request that is expensive to serve. What was wrong is that the cap was
/// silent: the endpoint returned the newest 10,000 rows of a 24,000-row match with a 200 and a
/// filename, the browser saved it, and the operator had a file that looked complete and was not.
/// An audit export that quietly omits rows is worse than a refused one.
/// </para>
/// <para>
/// <see cref="MatchCount"/> is a real second query rather than an estimate. It costs one indexed
/// count on a path that is already the expensive one, and it is what lets the UI say "the newest
/// 10,000 of 24,318" instead of nothing.
/// </para>
/// </remarks>
public sealed record CsvExport(string Content, int RowCount, int MatchCount, int RowLimit)
{
    public bool Truncated => MatchCount > RowCount;

    public byte[] ToBytes() => Encoding.UTF8.GetBytes(Content);
}

/// <summary>
/// Builds RFC 4180 CSV text.
/// </summary>
/// <remarks>
/// Byte-for-byte identical in all three services, so the platform.s exports quote the same way. The
/// four implementations that existed before this differed: two quoted only when a field contained a
/// comma, quote or newline, and two wrapped every field unconditionally — so the same audit row
/// exported from two screens produced different bytes.
/// <para>
/// Copied rather than referenced because the services share no assembly, which is the same trade the
/// approval and audit DTOs already make here. The copies must stay in step; the CSV tests in each
/// service.s suite cover the same cases for that reason.
/// </para>
/// </remarks>
public sealed class CsvBuilder
{
    private readonly StringBuilder _sb = new();

    public CsvBuilder(params string[] headers) => AppendRow(headers);

    public CsvBuilder AppendRow(params string?[] fields)
    {
        _sb.AppendLine(string.Join(",", fields.Select(Field)));
        return this;
    }

    public override string ToString() => _sb.ToString();

    /// <summary>
    /// Quotes a field when it contains a delimiter, a quote or a line break, doubling any embedded
    /// quote — and additionally when it opens with a character a spreadsheet would read as the start
    /// of a formula.
    /// </summary>
    /// <remarks>
    /// That last part is the CSV-injection guard, and it matters here specifically. Audit rows carry
    /// operator-supplied text — a rejection reason, a customer name, a user's own display name — and
    /// an export of them is opened in Excel by definition. A value beginning <c>=</c>, <c>+</c>,
    /// <c>-</c> or <c>@</c> is evaluated on open. Prefixing a tab inside the quoted field defuses it
    /// while leaving the value readable, which stripping or escaping the character would not.
    /// </remarks>
    private static string Field(string? value)
    {
        var text = value ?? string.Empty;

        if (text.Length > 0 && (text[0] is '=' or '+' or '-' or '@' or '\t' or '\r'))
        {
            return $"\"\t{text.Replace("\"", "\"\"")}\"";
        }

        return text.Contains(',') || text.Contains('"') || text.Contains('\n') || text.Contains('\r')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }
}
