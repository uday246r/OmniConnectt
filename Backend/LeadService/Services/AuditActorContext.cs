namespace LeadManagement.Api.Services;

/// <summary>
/// Overrides who audit rows are attributed to, for the rest of the current request.
/// </summary>
/// <remarks>
/// <para>
/// Exists for exactly one caller: the approval-replay endpoint. When AuthService replays an approved
/// Lead mutation, the inbound request carries the internal API key and no user token at all — so
/// <see cref="AuditLogService"/>'s normal token lookup finds nobody, and the local audit row would
/// read "Unattributed" for a change that has a perfectly well-known author.
/// </para>
/// <para>
/// The author is the MAKER who submitted it, not the checker who approved it, matching how
/// AuthService attributes the same replay in the central trail — an approved change reads in the
/// audit exactly as it would have if it had never been gated. The approval itself is recorded
/// separately, against the checker.
/// </para>
/// <para>
/// Scoped, so the override cannot leak between requests. It is a deliberate alternative to threading
/// an actor parameter through every service method the replay touches: those methods have no other
/// reason to know about audit attribution, and an optional parameter on each of them is a wider
/// surface for a future call site to get wrong than one object that only one endpoint ever sets.
/// </para>
/// </remarks>
public class AuditActorContext
{
    public AuditActor? Override { get; private set; }

    public void AttributeTo(Guid? userId, string? userName) =>
        Override = new AuditActor(userId?.ToString(), userName);
}
