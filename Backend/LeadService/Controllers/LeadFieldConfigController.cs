using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LeadManagement.Api.Controllers
{
    /// <summary>
    /// Lead Management's own Field Settings admin surface — mirrors
    /// Customer360Service/Controllers/FieldConfigController.cs's shape exactly, adapted to this
    /// service's own {success,data} response envelope (ApiResponseDto&lt;T&gt;) rather than
    /// Customer360's {status,data}, and keyed by Product (a real Guid row) instead of a fixed
    /// profile-type enum.
    /// </summary>
    [ApiController]
    [Route("api/lead-field-config")]
    [Authorize]
    public class LeadFieldConfigController : ControllerBase
    {
        private readonly LeadFieldConfigService _service;

        public LeadFieldConfigController(LeadFieldConfigService service)
        {
            _service = service;
        }

        [HttpGet("{subCategoryId:guid}")]
        // Field Settings edits this; the lead forms and details view obey it (required, masking, formats).
        [RequiresAnyCapability("FieldSettings:View", "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<List<LeadFieldConfig>>>> Get(Guid subCategoryId, CancellationToken ct)
        {
            var fields = await _service.GetBySubCategoryAsync(subCategoryId, ct);
            // The version Field Settings saves against — a save based on anything older is refused.
            Response.Headers.ETag = $"\"{LeadFieldConfigService.Fingerprint(fields)}\"";
            return Ok(new ApiResponseDto<List<LeadFieldConfig>> { Success = true, Data = fields });
        }

        /// <summary>
        /// The formats administrators defined in Settings → Manage Formats. The lead form checks a value
        /// against them as it is typed, and Field Settings offers them when choosing a field's format;
        /// the server checks them again on save either way.
        /// </summary>
        [HttpGet("formats")]
        [RequiresAnyCapability("FieldSettings:View", "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<IReadOnlyList<OmniConnect.Validation.FormatPreset>>>> Formats(
            [FromServices] ValidationPresetClient presets, CancellationToken ct)
        {
            return Ok(new ApiResponseDto<IReadOnlyList<OmniConnect.Validation.FormatPreset>> { Success = true, Data = await presets.GetAsync(ct) });
        }

        [HttpPut("{subCategoryId:guid}")]
        [RequiresCapability("FieldSettings", "Manage")]
        public async Task<IActionResult> Replace(Guid subCategoryId, [FromBody] List<LeadFieldConfig> fields, CancellationToken ct)
        {
            // If-Match carries the ETag the page loaded; absent, the save is not version-checked (older callers).
            var expectedVersion = Request.Headers.IfMatch.ToString().Trim().Trim('"');

            if (fields is not { Count: > 0 })
            {
                return BadRequest(new ApiResponseDto<List<LeadFieldConfig>> { Success = false, Message = "At least one field is required." });
            }

            try
            {
                var outcome = await _service.ReplaceAsync(subCategoryId, fields, CurrentUserId(), CurrentUserName(), bypassApproval: IsSuperAdmin(), ct, expectedVersion: string.IsNullOrEmpty(expectedVersion) ? null : expectedVersion);
                if (outcome.Pending is not null)
                {
                    // Gated: nothing was changed. 202 Accepted — the request is understood and queued, not applied.
                    return StatusCode(202, new ApiResponseDto<ApprovalPendingDto> { Success = true, Message = outcome.Pending.Message, Data = outcome.Pending });
                }

                Response.Headers.ETag = $"\"{LeadFieldConfigService.Fingerprint(outcome.Applied!)}\"";
                return Ok(new ApiResponseDto<List<LeadFieldConfig>> { Success = true, Data = outcome.Applied });
            }
            catch (LeadFieldConfigService.StaleSettingsException ex)
            {
                return Conflict(new ApiResponseDto<List<LeadFieldConfig>> { Success = false, Message = ex.Message });
            }
            catch (ApprovalServiceUnavailableException ex)
            {
                return StatusCode(503, new ApiResponseDto<List<LeadFieldConfig>> { Success = false, Message = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new ApiResponseDto<List<LeadFieldConfig>> { Success = false, Message = ex.Message });
            }
        }

        private Guid? CurrentUserId()
        {
            var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
                ?? User.FindFirst("sub")?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }

        private string? CurrentUserName() =>
            User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Name)?.Value
            ?? User.FindFirst("name")?.Value;

        /// <summary>
        /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict
        /// single-claim check — the exact claim AuthService issues — not this service's wider
        /// [RequiresCapability] admin test, so the population that skips assignment is identical
        /// across every service that has one of these helpers.
        /// </summary>
        private bool IsSuperAdmin() => User.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
    }
}
