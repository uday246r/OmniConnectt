using System.Net.Mime;
using System.Text.Json;
using LeadManagement.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;

namespace LeadManagement.Api.Middleware;

/// <summary>
/// Top-level exception middleware that ensures unhandled errors return safe RFC 7807 ProblemDetails
/// and keep CORS headers intact, preventing browser-level opaque CORS errors.
/// </summary>
/// <remarks>
/// A genuinely unexpected failure (a 500) is also reported to the platform's System Logs through
/// AuthService — the use <see cref="AuthServiceClient.PushSystemLogAsync"/> was written for and never
/// wired to, so a crash here was visible only in this process's console. Expected refusals (not found,
/// invalid input, approval service down) are not system faults and are not reported. Reporting is
/// bounded and best effort: it can never turn one failure into a slower one or a second one.
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
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The caller went away; there is nobody to answer and nothing went wrong on our side.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception processing request {Method} {Path}", context.Request.Method, context.Request.Path);
            if (StatusFor(ex) == StatusCodes.Status500InternalServerError)
            {
                await ReportAsync(context, ex);
            }
            await HandleExceptionAsync(context, ex);
        }
    }

    private static int StatusFor(Exception exception) => exception switch
    {
        KeyNotFoundException => StatusCodes.Status404NotFound,
        ArgumentException or InvalidOperationException => StatusCodes.Status400BadRequest,
        UnauthorizedAccessException => StatusCodes.Status401Unauthorized,
        ApprovalServiceUnavailableException => StatusCodes.Status503ServiceUnavailable,
        _ => StatusCodes.Status500InternalServerError
    };

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
                module: "Lead Management", statusCode: 500, stackTrace: ex.StackTrace, ct: budget.Token);
        }
        catch (Exception reportFailure)
        {
            logger.LogWarning(reportFailure, "Could not report an unhandled exception to System Logs.");
        }
    }

    private static async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.ContentType = MediaTypeNames.Application.Json;
        context.Response.StatusCode = StatusFor(exception);

        var problem = new ProblemDetails
        {
            Status = context.Response.StatusCode,
            Title = exception switch
            {
                KeyNotFoundException => "Resource Not Found",
                ArgumentException or InvalidOperationException => "Invalid Request",
                UnauthorizedAccessException => "Unauthorized",
                ApprovalServiceUnavailableException => "Approval Service Unavailable",
                _ => "An unexpected server error occurred."
            },
            Detail = exception is KeyNotFoundException or ArgumentException or InvalidOperationException or ApprovalServiceUnavailableException
                ? exception.Message
                : $"Please contact support if the issue persists. Reference: {context.TraceIdentifier}"
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(problem));
    }
}
