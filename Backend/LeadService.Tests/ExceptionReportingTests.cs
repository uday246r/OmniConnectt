using System.Net;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Middleware;
using LeadManagement.Api.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace LeadService.Tests;

/// <summary>
/// What happens when something genuinely breaks.
/// </summary>
/// <remarks>
/// Controllers caught every exception themselves and returned its raw message — SQL text, file paths —
/// to the browser, and the platform's System Logs never heard about it: the reporting method existed and
/// nothing called it. Unexpected failures now reach the middleware, which answers with a plain message
/// and a reference, and reports the detail to System Logs. Expected refusals are not reported as faults.
/// </remarks>
public class ExceptionReportingTests
{
    private readonly List<string> reportedPaths = [];

    private DefaultHttpContext Context()
    {
        var handler = new RecordingHandler(reportedPaths);
        var services = new ServiceCollection()
            .AddSingleton(new AuthServiceClient(
                new HttpClient(handler),
                MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
                NullLogger<AuthServiceClient>.Instance,
                new HttpContextAccessor()))
            .BuildServiceProvider();

        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static async Task<string> BodyOf(HttpContext context)
    {
        context.Response.Body.Position = 0;
        return await new StreamReader(context.Response.Body).ReadToEndAsync();
    }

    [Fact]
    public async Task An_unexpected_failure_is_reported_and_its_detail_is_not_shown_to_the_browser()
    {
        var context = Context();
        var middleware = new ExceptionMiddleware(_ => throw new NullReferenceException("connection string Host=db;Password=secret"), NullLogger<ExceptionMiddleware>.Instance);

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        Assert.DoesNotContain("secret", await BodyOf(context));
        Assert.Contains("/internal/system-logs", Assert.Single(reportedPaths));
    }

    [Fact]
    public async Task An_expected_refusal_is_answered_but_not_reported_as_a_fault()
    {
        var context = Context();
        var middleware = new ExceptionMiddleware(_ => throw new InvalidOperationException("Product 'X' is not recognized."), NullLogger<ExceptionMiddleware>.Instance);

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status400BadRequest, context.Response.StatusCode);
        Assert.Contains("is not recognized", await BodyOf(context));
        Assert.Empty(reportedPaths);
    }

    [Fact]
    public async Task A_reporting_outage_does_not_change_the_answer()
    {
        var context = Context();
        RecordingHandler.FailNext = true;
        var middleware = new ExceptionMiddleware(_ => throw new Exception("boom"), NullLogger<ExceptionMiddleware>.Instance);

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
    }

    private sealed class RecordingHandler(List<string> paths) : HttpMessageHandler
    {
        public static bool FailNext;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (FailNext)
            {
                FailNext = false;
                throw new HttpRequestException("AuthService is down");
            }

            paths.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }
}
