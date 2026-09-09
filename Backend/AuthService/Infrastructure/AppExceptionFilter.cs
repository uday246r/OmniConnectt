using AuthService.Application.Exceptions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AuthService.Infrastructure;

/// <summary>Maps the small set of domain exceptions Application/Services throws onto the right HTTP status, as ProblemDetails.</summary>
public class AppExceptionFilter(ILogger<AppExceptionFilter> logger) : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        var (status, title) = context.Exception switch
        {
            NotFoundAppException ex => (StatusCodes.Status404NotFound, ex.Message),
            PendingApprovalConflictException ex => (StatusCodes.Status409Conflict, ex.Message),
            ConflictAppException ex => (StatusCodes.Status409Conflict, ex.Message),
            ValidationAppException ex => (StatusCodes.Status400BadRequest, ex.Message),
            ForbiddenAppException ex => (StatusCodes.Status403Forbidden, ex.Message),
            GoneAppException ex => (StatusCodes.Status410Gone, ex.Message),

            // A constraint the application layer did not anticipate. This used to fall through to the
            // default handler, which in development returns the raw exception TYPE NAME as the
            // ProblemDetails title — the UI showed users a literal
            // "Microsoft.EntityFrameworkCore.DbUpdateException", which is both meaningless to them and
            // an internal-implementation leak.
            DbUpdateException ex => TranslateDbUpdate(ex),

            _ => (0, string.Empty),
        };

        if (status == 0)
        {
            return; // not ours — let the default developer/production exception handling deal with it
        }

        // Logged at the server with the real exception, so making the client-facing message safe does
        // not also make the failure invisible to whoever operates the platform.
        if (status >= StatusCodes.Status500InternalServerError)
        {
            logger.LogError(context.Exception, "Unhandled database error on {Path}", context.HttpContext.Request.Path);
        }

        var problem = new ProblemDetails { Title = title, Status = status };

        // A blocked-by-pending-approval refusal carries structured detail (which request, whose, with
        // which checker, since when) so the UI can render a real explanation instead of a bare toast.
        // ProblemDetails.Extensions is the standard place for this — it serialises alongside the
        // title/status without needing a bespoke response envelope.
        if (context.Exception is PendingApprovalConflictException conflict)
        {
            problem.Extensions["pendingRequest"] = conflict.Pending;
        }

        context.Result = new ObjectResult(problem) { StatusCode = status };
        context.ExceptionHandled = true;
    }

    private static (int, string) TranslateDbUpdate(DbUpdateException ex)
    {
        // A unique violation is a genuine conflict the caller can act on, so it earns a 409 and a
        // readable message (SQL Server error 2601 / 2627 for duplicate key / unique constraint).
    if (ex.InnerException is PostgresException pgEx && pgEx.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return (StatusCodes.Status409Conflict,
                "That value is already in use by another record.");
        }

        return (StatusCodes.Status500InternalServerError,
            "The change could not be saved. Please try again, or contact your administrator if it persists.");
    }
}
