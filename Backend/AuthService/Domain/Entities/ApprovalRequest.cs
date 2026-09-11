namespace AuthService.Domain.Entities;

/// <summary>
/// One Maker-Checker approval request. The single source of truth for the whole platform — AuthService
/// is the only place these are stored, mirroring exactly how AuditLog centralizes every service's audit
/// trail (see AuditLog.cs's own doc comment). A gated mutation never actually applies; instead one of
/// these rows is written, and the real mutation is replayed only once a checker approves it.
/// </summary>
public class ApprovalRequest
{
    public Guid Id { get; set; }

    /// <summary>Which module this request targets — a curated string (see ApprovalModuleKeys), not an
    /// enum, so a future module slots in with zero schema change.</summary>
    public required string Module { get; set; }

    /// <summary>Create / Update / Delete / Enable / Disable — see ApprovalActionKeys.</summary>
    public required string Action { get; set; }

    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? EntityLabel { get; set; }

    /// <summary>
    /// Stable business identity of whatever this request targets, used to enforce ONE open request per
    /// record. For an action against an existing row it is that row's id; for a Create — where no id
    /// exists yet — it is the natural key the module already treats as unique (a user's normalized
    /// email, a role's normalized name), so two makers cannot both queue "create foo@bar" and have the
    /// second one fail confusingly at approval time.
    ///
    /// Backed by a PARTIAL UNIQUE INDEX on (Module, EntityKey) WHERE Status = 'Pending' — see
    /// AuthDbContext. The application-level check in ApprovalGatingService.SubmitAsync produces the
    /// friendly "already pending" error; the index is what makes it true under concurrency. Null is
    /// permitted and never collides (Postgres treats NULLs as distinct in a unique index), which is
    /// what lets a remote module that hasn't adopted a key yet keep working unchanged.
    /// </summary>
    public string? EntityKey { get; set; }

    /// <summary>JSON snapshot of the entity's state before this change. Null for Create.</summary>
    public string? OldDataJson { get; set; }

    /// <summary>JSON of the request DTO the maker submitted.</summary>
    public required string NewDataJson { get; set; }

    /// <summary>Pending / Approved / Rejected.</summary>
    public required string Status { get; set; }

    public Guid MakerId { get; set; }
    /// <summary>Denormalized snapshot of the maker's name at request time — survives the maker account later being deleted.</summary>
    public string? MakerName { get; set; }

    /// <summary>The ONE specific checker auto-assigned at creation (least-current-workload selection). Only this
    /// user — not just any checker of the module — may approve or reject this particular request.</summary>
    public Guid CheckerId { get; set; }
    public string? CheckerName { get; set; }

    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? RejectionReason { get; set; }

    // ---- Phase 2 hooks — populated only by AuthService itself in Phase 1, left inert otherwise ----

    /// <summary>Which service originated this request. Always "AuthService" in Phase 1; Phase 2 remote
    /// services (LeadService, Customer360Service) populate their own name.</summary>
    public string SourceService { get; set; } = "AuthService";

    /// <summary>Phase 2: an internal-API-key-protected URL the origin remote service exposes to receive
    /// the approve/reject outcome and actually apply it. Null in Phase 1 — the mutation is replayed
    /// in-process instead, since AuthService owns Users/Roles directly.</summary>
    public string? CallbackUrl { get; set; }

    public string? CorrelationId { get; set; }

    // ---- One-time temporary password custody (Create-User approvals only) ----

    /// <summary>AES-256-GCM ciphertext (see SecretProtector) of the temporary password generated
    /// when this request was approved and replayed. Null for every request that isn't an approved
    /// (Users, Create) for a Local account — and null again the instant the maker reveals it.
    /// Nulling on reveal is what actually enforces one-time semantics: the secret stops existing,
    /// so a replayed request has nothing to return regardless of any flag.</summary>
    public string? TempPasswordCiphertext { get; set; }

    /// <summary>When the maker collected the password. Carries no secret — it exists so the reveal
    /// endpoint can tell "already collected" (410 Gone) apart from "there was never one here" (404),
    /// which a null ciphertext alone cannot distinguish.</summary>
    public DateTimeOffset? TempPasswordRevealedAt { get; set; }
}
