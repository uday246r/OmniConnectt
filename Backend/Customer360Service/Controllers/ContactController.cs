using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using backend.Data;
using backend.Infrastructure.Security;
using backend.Models;

namespace backend.Controllers
{
    [Authorize]
    [ApiController]
    [Route("v1/contactinfo")]
    [RequiresCapability("contact", "View")]
    // The data gate and the panel gate are the same request here, so both are checked at the same
    // point: contact:View says the caller may read contacts at all, panel.contacts says this profile
    // view may show them.
    [RequiresFineCapability("profile", "panel.contacts")]
    public class ContactController : ControllerBase
    {
        private readonly CrmProxyService _crmProxy;

        public ContactController(CrmProxyService crmProxy)
        {
            _crmProxy = crmProxy;
        }

        // GET /v1/contactinfo?type={type}&id={id}
        [HttpGet]
        public async Task<IActionResult> GetContactInfo([FromQuery] string? type, [FromQuery] string? id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'id' is required." });
            }

            var reqType = string.IsNullOrEmpty(type) ? "INDIVIDUAL" : type.ToUpper();
            var path = $"v1/contactinfo?type={reqType}&id={Uri.EscapeDataString(id)}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != System.Text.Json.JsonValueKind.Null)
                {
                    var contact = CrmMapper.Map<ContactDetail>(dataProp);
                    return Ok(new
                    {
                        status = 200,
                        data = contact
                    });
                }

                return NotFound(new { status = 404, message = "Not Found", detail = $"No contact details found for customer '{id}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }
    }
}
