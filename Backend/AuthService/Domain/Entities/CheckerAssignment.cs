namespace AuthService.Domain.Entities;

/// <summary>
/// Who may approve changes to a given module.
///
/// An assignment names EITHER a specific user OR a role — exactly one, never both and never neither.
/// Assigning a role expresses "any Manager can approve Lead edits", which is what makes the approval
/// queue survive staff changes: a new Manager can act the day they are given the role, and a
/// departing one stops being eligible the moment it is taken away, with no assignment to remember to
/// update.
///
/// A role assignment expands to its active members at selection time rather than being flattened
/// into per-user rows on save. Flattening would freeze the membership as it stood on the day the
/// assignment was made, which is precisely the problem this solves.
/// </summary>
public class CheckerAssignment
{
    public Guid Id { get; set; }
    public required string Module { get; set; }

    /// <summary>Set for a user assignment; null when <see cref="CheckerRoleId"/> is set.</summary>
    public Guid? CheckerUserId { get; set; }
    public User? CheckerUser { get; set; }

    /// <summary>Set for a role assignment; null when <see cref="CheckerUserId"/> is set.</summary>
    public Guid? CheckerRoleId { get; set; }
    public Role? CheckerRole { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public Guid? CreatedBy { get; set; }

    /// <summary>Mirrors the database check constraint; useful for guarding in code before a save.</summary>
    public bool IsValidTarget => CheckerUserId.HasValue ^ CheckerRoleId.HasValue;
}
