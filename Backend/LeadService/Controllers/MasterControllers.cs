using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Services;

namespace LeadManagement.Api.Controllers
{
    [ApiController]
    [Route("api/products")]
    [Route("api/v1/products")]
    [Route("products")]
    // [Authorize], not [AllowAnonymous]: the [RequiresCapability] attributes on the actions below
    // are a hand-written IAsyncAuthorizationFilter, which does NOT honour IAllowAnonymous metadata.
    // These endpoints have therefore always demanded an authenticated caller holding MasterData:View —
    // the [AllowAnonymous] simply misdescribed the contract, and every real caller already sends a token.
    [Authorize]
    public class ProductsController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public ProductsController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet]
        [RequiresCapability("MasterData", "View")]
        public async Task<ActionResult<ApiResponseDto<List<DropdownOptionDto>>>> GetProducts()
        {
            var data = await _masterDataService.GetProductsAsync();
            return Ok(new ApiResponseDto<List<DropdownOptionDto>> { Success = true, Data = data });
        }

        /// <summary>Field Settings' product tabs need the real Product Guid — GetProducts above
        /// deliberately returns name-only dropdown options, which every existing consumer (lead
        /// submission, filters) matches by name, not id.</summary>
        [HttpGet("full")]
        // The lead forms resolve a product's field configuration by this id too, not only Field Settings.
        [RequiresAnyCapability("FieldSettings:View", "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<List<ProductWithIdDto>>>> GetProductsWithId()
        {
            var data = await _masterDataService.GetProductsWithIdAsync();
            return Ok(new ApiResponseDto<List<ProductWithIdDto>> { Success = true, Data = data });
        }
    }

    [ApiController]
    [Route("api/states")]
    [Route("api/v1/states")]
    [Route("states")]
    // [Authorize], not [AllowAnonymous]: the [RequiresCapability] attributes on the actions below
    // are a hand-written IAsyncAuthorizationFilter, which does NOT honour IAllowAnonymous metadata.
    // These endpoints have therefore always demanded an authenticated caller holding MasterData:View —
    // the [AllowAnonymous] simply misdescribed the contract, and every real caller already sends a token.
    [Authorize]
    public class StatesController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public StatesController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet]
        [RequiresCapability("MasterData", "View")]
        public async Task<ActionResult<ApiResponseDto<List<DropdownOptionDto>>>> GetStates()
        {
            var data = await _masterDataService.GetStatesAsync();
            return Ok(new ApiResponseDto<List<DropdownOptionDto>> { Success = true, Data = data });
        }
    }

    [ApiController]
    [Route("api/branches")]
    [Route("api/v1/branches")]
    [Route("branches")]
    // [Authorize], not [AllowAnonymous]: the [RequiresCapability] attributes on the actions below
    // are a hand-written IAsyncAuthorizationFilter, which does NOT honour IAllowAnonymous metadata.
    // These endpoints have therefore always demanded an authenticated caller holding MasterData:View —
    // the [AllowAnonymous] simply misdescribed the contract, and every real caller already sends a token.
    [Authorize]
    public class BranchesController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public BranchesController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet]
        [RequiresCapability("MasterData", "View")]
        public async Task<ActionResult<ApiResponseDto<List<DropdownOptionDto>>>> GetBranches([FromQuery] string? state, [FromQuery] string? q)
        {
            var data = await _masterDataService.GetBranchesAsync(state, q);
            return Ok(new ApiResponseDto<List<DropdownOptionDto>> { Success = true, Data = data });
        }
    }

    [ApiController]
    [Route("api/sales-executives")]
    [Route("api/v1/sales-executives")]
    [Route("sales-executives")]
    // [Authorize], not [AllowAnonymous]: the [RequiresCapability] attributes on the actions below
    // are a hand-written IAsyncAuthorizationFilter, which does NOT honour IAllowAnonymous metadata.
    // These endpoints have therefore always demanded an authenticated caller holding MasterData:View —
    // the [AllowAnonymous] simply misdescribed the contract, and every real caller already sends a token.
    [Authorize]
    public class SalesExecutivesController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public SalesExecutivesController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet]
        [RequiresCapability("MasterData", "View")]
        public async Task<ActionResult<ApiResponseDto<List<DropdownOptionDto>>>> GetSalesExecutives([FromQuery] string? q)
        {
            var data = await _masterDataService.GetSalesExecutivesAsync(q);
            return Ok(new ApiResponseDto<List<DropdownOptionDto>> { Success = true, Data = data });
        }
    }

    [ApiController]
    [Route("api/reference-data")]
    [Route("api/v1/reference-data")]
    [Route("reference-data")]
    // [Authorize], not [AllowAnonymous]: the [RequiresCapability] attributes on the actions below
    // are a hand-written IAsyncAuthorizationFilter, which does NOT honour IAllowAnonymous metadata.
    // These endpoints have therefore always demanded an authenticated caller holding MasterData:View —
    // the [AllowAnonymous] simply misdescribed the contract, and every real caller already sends a token.
    [Authorize]
    public class ReferenceDataController : ControllerBase
    {
        private readonly IMasterDataService _masterDataService;

        public ReferenceDataController(IMasterDataService masterDataService)
        {
            _masterDataService = masterDataService;
        }

        [HttpGet]
        [RequiresCapability("MasterData", "View")]
        public async Task<ActionResult<ApiResponseDto<ReferenceDataDto>>> GetReferenceData()
        {
            var data = await _masterDataService.GetReferenceDataAsync();
            return Ok(new ApiResponseDto<ReferenceDataDto> { Success = true, Data = data });
        }
    }
}
