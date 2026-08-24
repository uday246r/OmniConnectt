using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using backend.Data;
using backend.Infrastructure.Security;

namespace backend.Controllers
{
    [Authorize]
    [ApiController]
    [Route("v1/interactions")]
    [RequiresCapability("interactions", "View")]
    public class InteractionController : ControllerBase
    {
        private readonly CrmProxyService _crmProxy;

        public InteractionController(CrmProxyService crmProxy)
        {
            _crmProxy = crmProxy;
        }

        // GET /v1/interactions/{id}?pageNumber={pageNumber}&pageSize={pageSize}
        [HttpGet("{id}")]
        public async Task<IActionResult> GetCustomerInteractions(
            string id,
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10)
        {
            if (string.IsNullOrEmpty(id))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Path parameter 'id' is required." });
            }

            /*
             * Clamp before forwarding. pageSize goes straight into the upstream CRM request, so
             * without this a single call for pageSize=1000000 is passed along verbatim — a trivially
             * cheap request that is expensive for someone else to serve. 100 matches the cap
             * AuthService and ModuleRegistry already enforce.
             */
            pageNumber = Math.Max(pageNumber, 1);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var path = $"v1/interactions/{Uri.EscapeDataString(id)}?pageNumber={pageNumber}&pageSize={pageSize}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp))
                {
                    var interactions = CrmMapper.MapList<backend.Models.Interaction>(dataProp);
                    int totalCount = root.TryGetPropertyCaseInsensitive("totalCount", out var tc) ? tc.GetInt32() : interactions.Count;
                    int totalPages = root.TryGetPropertyCaseInsensitive("totalPages", out var tp) ? tp.GetInt32() : 1;

                    return Ok(new
                    {
                        status = 200,
                        data = interactions,
                        pageNumber = pageNumber,
                        pageSize = pageSize,
                        totalCount = totalCount,
                        totalPages = totalPages
                    });
                }

                return Ok(new
                {
                    status = 200,
                    data = new System.Collections.Generic.List<backend.Models.Interaction>(),
                    pageNumber = pageNumber,
                    pageSize = pageSize,
                    totalCount = 0,
                    totalPages = 1
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }
    }
}
