namespace AuthService.Application.DTOs;

/// <summary>
/// Renders an <see cref="AuditLogFilter"/> as the short human phrase an export's audit row carries.
/// </summary>
/// <remarks>
/// An export event that records only "someone exported the audit log" answers half the question.
/// "Exported one user's activity for last Tuesday" and "exported the entire trail, unfiltered" are
/// very different findings, and the difference lives entirely in the filter that produced the file.
/// Recording it here means the row says which of the two happened.
/// </remarks>
public static class AuditFilterDescription
{
    public static string Describe(AuditLogFilter f)
    {
        var parts = new List<string>();

        Add(parts, "service", f.Service);
        Add(parts, "application", f.SourceApplication);
        Add(parts, "action", f.Action);
        Add(parts, "category", f.ActionCategory);
        Add(parts, "module", f.Module);
        Add(parts, "page", f.PageName);
        Add(parts, "result", f.Result);
        Add(parts, "actor", f.ActorUserId?.ToString() ?? f.ActorName);
        Add(parts, "record", f.EntityId ?? f.EntityType);
        Add(parts, "operation", f.CorrelationId);
        Add(parts, "signInMethod", f.AuthMethod);
        Add(parts, "ip", f.SourceIp);
        Add(parts, "device", f.Device);
        if (f.From is not null) parts.Add($"from={f.From:O}");
        if (f.To is not null) parts.Add($"to={f.To:O}");

        // Saying so explicitly, rather than leaving the clause off, is the point: an unfiltered
        // export of the whole trail is the case a reviewer most wants to be able to spot.
        return parts.Count == 0 ? "none (the entire trail)" : string.Join(", ", parts);
    }

    private static void Add(List<string> parts, string name, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            parts.Add($"{name}='{value}'");
        }
    }
}
