using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Services;

namespace LeadManagement.Api.Controllers
{
    [ApiController]
    [Route("api/dashboard")]
    [Route("api/v1/dashboard")]
    [Route("dashboard")]
    [Authorize]
    public class DashboardController : ControllerBase
    {
        private readonly IDashboardService _dashboardService;
        private readonly IDashboardExternalService _externalService;
        private readonly KpiVisibilityService _kpiVisibility;

        public DashboardController(
            IDashboardService dashboardService,
            IDashboardExternalService externalService,
            KpiVisibilityService kpiVisibility)
        {
            _dashboardService = dashboardService;
            _externalService = externalService;
            _kpiVisibility = kpiVisibility;
        }

        /// <summary>
        /// Three of the five KPI cards, in one response.
        /// </summary>
        /// <remarks>
        /// The other two have endpoints of their own and are guarded by an attribute. These three do
        /// not: they are computed together from one pass over the same data, and splitting them into
        /// three endpoints to make them separately attribute-guardable would triple the query cost to
        /// serve a page that always asks for all three.
        /// <para>
        /// So they are filtered out of the response instead. That is still server-side enforcement —
        /// a caller who was not granted a card cannot obtain its number by calling this directly —
        /// it just happens after the handler rather than before it.
        /// </para>
        /// </remarks>
        [HttpGet("kpis")]
        [RequiresCapability("Dashboard", "View")]
        public async Task<ActionResult<ApiResponseDto<KpiSummaryDto>>> GetKpiSummary([FromQuery] DashboardFilterDto filters)
        {
            var data = await _dashboardService.GetKpiSummaryAsync(filters);
            await _kpiVisibility.RedactAsync(data, User, HttpContext.RequestAborted);
            return Ok(new ApiResponseDto<KpiSummaryDto> { Success = true, Data = data });
        }

        [HttpGet("in-progress")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "kpi.in-progress")]
        public async Task<ActionResult<ApiResponseDto<InProgressKpiDto>>> GetInProgress([FromQuery] DashboardFilterDto filters)
        {
            var value = await _externalService.GetInProgressCountAsync(filters);
            var dto = new InProgressKpiDto
            {
                InProgressLeads = value,
                IsAvailable = value.HasValue
            };
            return Ok(new ApiResponseDto<InProgressKpiDto> { Success = true, Data = dto });
        }

        [HttpGet("conversion-rate")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "kpi.conversion-rate")]
        public async Task<ActionResult<ApiResponseDto<ConversionRateKpiDto>>> GetConversionRate([FromQuery] DashboardFilterDto filters)
        {
            var value = await _externalService.GetConversionRateAsync(filters);
            var dto = new ConversionRateKpiDto
            {
                ConversionRate = value,
                IsAvailable = value.HasValue
            };
            return Ok(new ApiResponseDto<ConversionRateKpiDto> { Success = true, Data = dto });
        }

        [HttpGet("leads-over-time")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "chart.leads-over-time")]
        public async Task<ActionResult<ApiResponseDto<List<TimeSeriesPointDto>>>> GetLeadsOverTime([FromQuery] DashboardFilterDto filters)
        {
            var data = await _dashboardService.GetLeadsOverTimeAsync(filters);
            return Ok(new ApiResponseDto<List<TimeSeriesPointDto>> { Success = true, Data = data });
        }

        [HttpGet("leads-by-product")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "chart.leads-by-product")]
        public async Task<ActionResult<ApiResponseDto<List<ProductDistributionDto>>>> GetLeadsByProduct([FromQuery] DashboardFilterDto filters)
        {
            var data = await _dashboardService.GetLeadsByProductAsync(filters);
            return Ok(new ApiResponseDto<List<ProductDistributionDto>> { Success = true, Data = data });
        }

        [HttpGet("leads-by-branch")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "chart.leads-by-branch")]
        public async Task<ActionResult<ApiResponseDto<List<BranchDistributionDto>>>> GetLeadsByBranch([FromQuery] DashboardFilterDto filters)
        {
            var data = await _dashboardService.GetLeadsByBranchAsync(filters);
            return Ok(new ApiResponseDto<List<BranchDistributionDto>> { Success = true, Data = data });
        }

        [HttpGet("recent-leads")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "widget.recent-leads")]
        public async Task<ActionResult<ApiResponseDto<List<LeadRecordDto>>>> GetRecentLeads([FromQuery] DashboardFilterDto filters, [FromQuery] int limit = 5)
        {
            var data = await _dashboardService.GetRecentLeadsAsync(filters, limit);
            return Ok(new ApiResponseDto<List<LeadRecordDto>> { Success = true, Data = data });
        }

        [HttpGet("top-sales-executives")]
        [RequiresCapability("Dashboard", "View")]
        [RequiresFineCapability("Dashboard", "widget.top-sales-executives")]
        public async Task<ActionResult<ApiResponseDto<List<TopSalesExecutiveDto>>>> GetTopSalesExecutives([FromQuery] DashboardFilterDto filters, [FromQuery] int limit = 5)
        {
            var data = await _dashboardService.GetTopSalesExecutivesAsync(filters, limit);
            return Ok(new ApiResponseDto<List<TopSalesExecutiveDto>> { Success = true, Data = data });
        }
    }
}
