namespace AuthService.Infrastructure.Locking;

/// <summary>
/// A mutual exclusion primitive that holds across every replica of this service, so work that must
/// happen exactly once — the remote-app health sweep — is not run N times by N instances.
/// </summary>
public interface IDistributedLock
{
    /// <summary>
    /// Takes the lock if it is free, or returns <c>null</c> immediately if it is held. Never waits:
    /// every caller here has something better to do than queue behind a peer already doing the work.
    /// </summary>
    /// <param name="ttl">
    /// How long the lock survives without being released. This is the backstop for a holder that is
    /// killed mid-work — without it, one crashed replica would block the sweep forever. Set it longer
    /// than the work can reasonably take.
    /// </param>
    /// <returns>A handle whose disposal releases the lock, or <c>null</c> if it is held elsewhere.</returns>
    Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default);
}
