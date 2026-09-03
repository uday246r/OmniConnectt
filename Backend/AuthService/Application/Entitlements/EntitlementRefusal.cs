using Microsoft.AspNetCore.Mvc;

namespace AuthService.Application.Entitlements;

/// <summary>
/// The refusal returned when a feature is not licensed.
/// <para>
/// It carries a distinct <c>type</c> so the host can tell "your plan does not include this" from
/// "your role does not allow this" and render an upsell instead of a permission error. Without that
/// discriminator the two are indistinguishable on the wire, and an unlicensed module looks to the
/// user like a misconfigured role — which sends them to their administrator instead of to sales.
/// </para>
/// <para>
/// 403 rather than 402 Payment Required: 402 is inconsistently handled by proxies and HTTP clients,
/// and the semantics here are "refused, and paying is how you fix it", which 403 with a typed body
/// conveys without the interoperability risk.
/// </para>
/// </summary>
public static class EntitlementRefusal
{
    public const string ProblemType = "https://omniremit.dev/errors/not-entitled";

    public static ObjectResult Result(string featureKey, string? lockReason)
    {
        var problem = new ProblemDetails
        {
            Title = "This module is not included in your plan.",
            Type = ProblemType,
            Status = StatusCodes.Status403Forbidden,
        };
        problem.Extensions["featureKey"] = featureKey;
        problem.Extensions["reason"] = lockReason;

        return new ObjectResult(problem) { StatusCode = StatusCodes.Status403Forbidden };
    }
}
