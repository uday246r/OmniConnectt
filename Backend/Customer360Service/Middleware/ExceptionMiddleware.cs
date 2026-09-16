using backend.Infrastructure;

namespace backend.Middleware;

/// <summary>
/// Registered before CORS/authentication (see Program.cs) so an exception anywhere downstream —
/// including inside the auth handler — still comes back as a real JSON error with CORS headers
/// intact, rather than a bare 500 the browser reports as an opaque CORS failure.
/// </summary>
/// <remarks>
/// <para>
/// An unexpected failure is now also reported to the platform's System Logs through AuthService, so it
/// is visible to the people who look there rather than only in this process's console. It used to be
/// neither: the exception's own message was returned to the browser — internal detail such as SQL or
/// file paths, shown to whoever triggered it — and nothing was recorded centrally.
/// </para>
/// <para>
/// Reporting is best effort and bounded: it can never turn one failure into a slower one or a second one.
/// </para>
/// </remarks>
public class ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger)
{
    private static readonly TimeSpan ReportBudget = TimeSpan.FromSeconds(2);

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (ApprovalServiceUnavailableException ex)
        {
            // A gating check that couldn't be verified must block the mutation, not silently apply
            // it — never collapse this into the generic 500 branch below.
            if (context.Response.HasStarted) throw;
            context.Response.StatusCode = 503;
            await context.Response.WriteAsJsonAsync(new { success = false, message = ex.Message });
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !context.RequestAborted.IsCancellationRequested)
        {
            logger.LogError(ex, "Unhandled exception processing {Method} {Path}", context.Request.Method, context.Request.Path);
            await ReportAsync(context, ex);

            if (context.Response.HasStarted) return;
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                message = "Something went wrong on our side. Please try again; if it keeps happening, contact support.",
                referenceId = context.TraceIdentifier,
            });
        }
    }

    private async Task ReportAsync(HttpContext context, Exception ex)
    {
        try
        {
            var client = context.RequestServices.GetService<AuthServiceClient>();
            if (client is null) return;

            using var budget = new CancellationTokenSource(ReportBudget);
            await client.PushSystemLogAsync(
                "Error", "unhandled_exception",
                $"{context.Request.Method} {context.Request.Path} failed: {ex.GetType().Name}: {ex.Message}",
                module: "Customer 360", statusCode: 500, stackTrace: ex.StackTrace, ct: budget.Token);
        }
        catch (Exception reportFailure)
        {
            logger.LogWarning(reportFailure, "Could not report an unhandled exception to System Logs.");
        }
    }
}
