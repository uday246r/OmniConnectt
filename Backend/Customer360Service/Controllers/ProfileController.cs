using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

using backend.Data;
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

        public ProfileController(CrmProxyService crmProxy, IConfiguration configuration)
        {
            _crmProxy = crmProxy;
            _configuration = configuration;
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
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp))
                {
                    var profiles = CrmMapper.MapList<IndividualProfile>(dataProp);
                    return Ok(new
                    {
                        status = 200,
                        data = profiles
                    });
                }

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
                return StatusCode(response.StatusCode, response.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(response.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp))
                {
                    var profiles = CrmMapper.MapList<CorporateProfile>(dataProp);
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

                return NotFound(new { status = 404, message = "Not Found", detail = $"No corporate profile found for ID '{id}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }
    }
}
