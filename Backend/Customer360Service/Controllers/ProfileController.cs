using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

using backend.Data;
using backend.Infrastructure.Audit;
using backend.Infrastructure.Security;
using backend.Models;

namespace backend.Controllers
{
    /*
     * Capability attributes are per-ACTION here, not on the class.
     *
     * The class-level [RequiresCapability("profile","View")] applied to /v1/lookups too — static
     * dropdown configuration containing no customer data — and a method-level [AllowAnonymous] could
     * not lift it, because a hand-written IAsyncAuthorizationFilter does not honour IAllowAnonymous.
     * Declaring the requirement on the two actions that actually return customer data is both honest
     * about the contract and the only way to exempt the one that doesn't.
     */
    [Authorize]
    [ApiController]
    [Route("v1")]
    public class ProfileController : ControllerBase
    {
        private readonly CrmProxyService _crmProxy;
        private readonly IConfiguration _configuration;
        private readonly Customer360AuditWriter _audit;

        public ProfileController(CrmProxyService crmProxy, IConfiguration configuration, Customer360AuditWriter audit)
        {
            _crmProxy = crmProxy;
            _configuration = configuration;
            _audit = audit;
        }

        public class LookupOption
        {
            public string Value { get; set; } = string.Empty;
            public string Label { get; set; } = string.Empty;
        }

        /*
         * GET /v1/lookups — the search-type dropdown options (NRIC, Phone, Name, …). Static
         * configuration, no customer data, so it is available to any authenticated user of this app.
         *
         * It previously carried [AllowAnonymous], which did nothing: the class-level
         * [RequiresCapability("profile","View")] is a hand-written IAsyncAuthorizationFilter, and only
         * the built-in AuthorizeFilter/AuthorizationMiddleware honour IAllowAnonymous metadata. So the
         * attribute advertised "public" while the endpoint actually demanded profile:View — and the
         * search form silently rendered with no options for anyone who lacked it.
         *
         * Kept authenticated (the class [Authorize] still applies) but with the capability requirement
         * genuinely lifted, which is what the [AllowAnonymous] was reaching for.
         */
        [HttpGet("lookups")]
        public IActionResult GetLookups()
        {
            var section = _configuration.GetSection("SearchOptions");
            if (!section.Exists())
            {
                return Ok(new
                {
                    status = 200,
                    data = new
                    {
                        idTypes = new[]
                        {
                            new { value = "Phone", label = "Phone Number" },
                            new { value = "Name", label = "Full Name" },
                            new { value = "NRIC", label = "National ID (NRIC)" },
                            new { value = "SecondaryID", label = "Secondary ID" }
                        },
                        secondaryIdTypes = new[]
                        {
                            new { value = "PASSPORT", label = "Passport" },
                            new { value = "OLDID", label = "Old IC" },
                            new { value = "POLICENUMBER", label = "Police ID / Army ID" }
                        },
                        corpSearchTypes = new[]
                        {
                            new { value = "BRN", label = "BRN" },
                            new { value = "OLDBRN", label = "Old BRN" },
                            new { value = "COMPANYNAME", label = "Company Name" }
                        }
                    }
                });
            }

            var idTypes = section.GetSection("IdTypes").Get<List<LookupOption>>();
            var secondaryIdTypes = section.GetSection("SecondaryIdTypes").Get<List<LookupOption>>();
            var corpSearchTypes = section.GetSection("CorpSearchTypes").Get<List<LookupOption>>();

            return Ok(new
            {
                status = 200,
                data = new
                {
                    idTypes,
                    secondaryIdTypes,
                    corpSearchTypes
                }
            });
        }

        /// <summary>
        /// Records a completed customer lookup.
        /// </summary>
        /// <remarks>
        /// One row per lookup, whether or not it matched. A search that returns nothing is still an
        /// access attempt against a specific identifier, and a sequence of them is the most legible
        /// signal there is that someone is fishing — which is precisely what the browser-written
        /// version of this could never show, since it only reported lookups that found somebody.
        ///
        /// The identifier searched for is recorded; the profile payload is not. Who looked for whom
        /// is the auditable fact. Copying the customer's data into the audit trail would spread the
        /// PII into a second table with a wider audience, which is the opposite of the point.
        /// </remarks>
        private Task WriteLookupAuditAsync(
            string customerType, string? searchType, string searchId, int matchCount,
            string? matchedName, string page)
        {
            var found = matchCount > 0;
            return _audit.WriteAsync(
                // VIEW_PROFILE when it resolved to a real customer, SEARCH when it did not. The
                // remote's own Audit Logs screen matches "VIEW" as a prefix, so the first form lands
                // under its View filter and the second does not — which is the distinction an
                // operator reading that screen actually wants.
                action: found ? "VIEW_PROFILE" : "SEARCH",
                centralAction: found ? "customer360.profile_viewed" : "customer360.profile_searched",
                description: found
                    ? $"Viewed {customerType.ToLowerInvariant()} profile for {matchedName ?? searchId} (searched by {searchType ?? "unspecified"} '{searchId}')."
                    : $"Searched {customerType.ToLowerInvariant()} profiles by {searchType ?? "unspecified"} '{searchId}' — no match.",
                customerName: matchedName,
                customerType: customerType,
                customerId: searchId,
                module: "Customer 360",
                page: page,
                actionCategory: found ? "ViewDetails" : "Search",
                ct: HttpContext.RequestAborted);
        }

        // GET /v1/indprofile?type=NRIC&id=92418-14-5678
        [RequiresCapability("profile", "View")]
        [HttpGet("indprofile")]
        public async Task<IActionResult> GetIndividualProfile([FromQuery] string? type, [FromQuery] string? id, [FromQuery] string? subtype)
        {
            if (string.IsNullOrEmpty(id))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'id' is required." });
            }

            var cleanId = (id ?? "").Trim();
            var path = $"v1/indprofile?type={type ?? ""}&id={Uri.EscapeDataString(cleanId)}";
            if (!string.IsNullOrEmpty(subtype))
            {
                path += $"&subtype={subtype}";
            }

            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                /*
                 * A refused lookup is recorded, not just a successful one.
                 *
                 * The browser used to decide what got logged, and it only ever reported the happy
                 * path — so a run of failed lookups against a customer, which is what a probing
                 * attempt looks like, left no trace at all. Recording the attempt is the point.
                 */
                await _audit.WriteFailureAsync(
                    "SEARCH", "customer360.profile_searched",
                    $"Individual profile lookup by {type ?? "unspecified"} '{cleanId}' failed ({res.StatusCode}).",
                    customerId: cleanId, page: "individual", actionCategory: "Search",
                    ct: HttpContext.RequestAborted);
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp))
                {
                    var profiles = CrmMapper.MapList<IndividualProfile>(dataProp);
                    await WriteLookupAuditAsync(
                        "Individual", type, cleanId, profiles?.Count ?? 0,
                        profiles?.FirstOrDefault()?.FullName, "individual");
                    return Ok(new
                    {
                        status = 200,
                        data = profiles
                    });
                }

                await WriteLookupAuditAsync("Individual", type, cleanId, 0, null, "individual");
                return Ok(new
                {
                    status = 200,
                    data = new System.Collections.Generic.List<IndividualProfile>()
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/corpprofile
        [RequiresCapability("profile", "View")]
        [HttpGet("corpprofile")]
        public async Task<IActionResult> GetCorporateProfile([FromQuery] string? type, [FromQuery] string? id)
        {
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(type))
            {
                return BadRequest(new
                {
                    status = 400,
                    message = "Bad Request. The CRM API requires 'id' and 'type' (e.g. BRN, OLDBRN, COMPANYNAME) parameters to search for corporate profiles."
                });
            }

            var cleanId = id.Trim();
            var pathSingle = $"v1/corpprofile?type={type}&id={Uri.EscapeDataString(cleanId)}";
            var response = await _crmProxy.ProxyGetAsync(pathSingle, HttpContext.RequestAborted);
            if (!response.IsSuccess)
            {
                await _audit.WriteFailureAsync(
                    "SEARCH", "customer360.profile_searched",
                    $"Corporate profile lookup by {type} '{cleanId}' failed ({response.StatusCode}).",
                    customerId: cleanId, page: "non-individual", actionCategory: "Search",
                    ct: HttpContext.RequestAborted);
                return StatusCode(response.StatusCode, response.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(response.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp))
                {
                    var profiles = CrmMapper.MapList<CorporateProfile>(dataProp);
                    await WriteLookupAuditAsync(
                        "Non-Individual", type, cleanId, profiles?.Count ?? 0,
                        profiles?.FirstOrDefault()?.OrganizationName, "non-individual");
                    if (profiles == null || !profiles.Any())
                    {
                        return NotFound(new { status = 404, message = "Not Found", detail = $"No corporate profile found for ID '{id}'." });
                    }
                    return Ok(new
                    {
                        status = 200,
                        data = profiles
                    });
                }

                await WriteLookupAuditAsync("Non-Individual", type, cleanId, 0, null, "non-individual");
                return NotFound(new { status = 404, message = "Not Found", detail = $"No corporate profile found for ID '{id}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }
    }
}
