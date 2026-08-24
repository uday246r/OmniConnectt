using System;
using System.Collections.Generic;
using System.Text.Json;
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
    [Route("v1")]
    [RequiresCapability("products", "View")]
    public class ProductController : ControllerBase
    {
        private readonly CrmProxyService _crmProxy;

        public ProductController(CrmProxyService crmProxy)
        {
            _crmProxy = crmProxy;
        }

        // GET /v1/customerproduct?type={type}&id={id}&pageNumber={pageNumber}&pageSize={pageSize}
        [HttpGet("customerproduct")]
        public async Task<IActionResult> GetCustomerProducts(
            [FromQuery] string? type,
            [FromQuery] string? id,
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10)
        {
            if (string.IsNullOrEmpty(id))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'id' is required." });
            }

            /*
             * Clamp before forwarding. pageSize goes straight into the upstream CRM request, so
             * without this a single call for pageSize=1000000 is passed along verbatim — a trivially
             * cheap request that is expensive for someone else to serve. 100 matches the cap
             * AuthService and ModuleRegistry already enforce.
             */
            pageNumber = Math.Max(pageNumber, 1);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var reqType = string.IsNullOrEmpty(type) ? "INDIVIDUAL" : type.ToUpper();
            var path = $"v1/customerproduct?type={reqType}&id={Uri.EscapeDataString(id)}&pageNumber={pageNumber}&pageSize={pageSize}";
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
                    var products = CrmMapper.MapList<CustomerProduct>(dataProp);
                    int totalCount = root.TryGetPropertyCaseInsensitive("totalCount", out var tc) ? tc.GetInt32() : products.Count;
                    int totalPages = root.TryGetPropertyCaseInsensitive("totalPages", out var tp) ? tp.GetInt32() : 1;

                    return Ok(new
                    {
                        status = 200,
                        data = products,
                        pageNumber = pageNumber,
                        pageSize = pageSize,
                        totalCount = totalCount,
                        totalPages = totalPages
                    });
                }

                return Ok(new
                {
                    status = 200,
                    data = new List<CustomerProduct>(),
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

        // GET /v1/product/deposit?id={id}&accountNo={accountNo}
        [HttpGet("product/deposit")]
        public async Task<IActionResult> GetDepositProduct([FromQuery] string? id, [FromQuery] string? accountNo)
        {
            if (string.IsNullOrEmpty(accountNo))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'accountNo' is required." });
            }

            var path = $"v1/product/deposit?id={Uri.EscapeDataString(id ?? "")}&accountNo={Uri.EscapeDataString(accountNo)}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null)
                {
                    var product = CrmMapper.Map<DepositProduct>(dataProp);
                    return Ok(new { status = 200, data = product });
                }
                return NotFound(new { status = 404, message = "Not Found", detail = $"No deposit product found for account number '{accountNo}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/loan?id={id}&accountNo={accountNo}
        [HttpGet("product/loan")]
        public async Task<IActionResult> GetLoanProduct([FromQuery] string? id, [FromQuery] string? accountNo)
        {
            if (string.IsNullOrEmpty(accountNo))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'accountNo' is required." });
            }

            var path = $"v1/product/loan?id={Uri.EscapeDataString(id ?? "")}&accountNo={Uri.EscapeDataString(accountNo)}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null)
                {
                    var product = CrmMapper.Map<LoanProduct>(dataProp);
                    return Ok(new { status = 200, data = product });
                }
                return NotFound(new { status = 404, message = "Not Found", detail = $"No loan product found for account number '{accountNo}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/cards?id={id}&accountNo={accountNo}&type={type}
        [HttpGet("product/cards")]
        public async Task<IActionResult> GetCardsProduct([FromQuery] string? id, [FromQuery] string? accountNo, [FromQuery] string? type)
        {
            if (string.IsNullOrEmpty(accountNo))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'accountNo' is required." });
            }

            var path = $"v1/product/cards?id={Uri.EscapeDataString(id ?? "")}&accountNo={Uri.EscapeDataString(accountNo)}&type={Uri.EscapeDataString(type ?? "")}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null)
                {
                    var product = CrmMapper.Map<CardsProduct>(dataProp);
                    return Ok(new { status = 200, data = product });
                }
                return NotFound(new { status = 404, message = "Not Found", detail = $"No card product found for account number '{accountNo}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/gold?id={id}&accountNo={accountNo}
        [HttpGet("product/gold")]
        public async Task<IActionResult> GetGoldProduct([FromQuery] string? id, [FromQuery] string? accountNo)
        {
            if (string.IsNullOrEmpty(accountNo))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'accountNo' is required." });
            }

            var path = $"v1/product/gold?id={Uri.EscapeDataString(id ?? "")}&accountNo={Uri.EscapeDataString(accountNo)}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null)
                {
                    var product = CrmMapper.Map<GoldProduct>(dataProp);
                    return Ok(new { status = 200, data = product });
                }
                return NotFound(new { status = 404, message = "Not Found", detail = $"No gold product found for account number '{accountNo}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/wm?id={id}&policyNo={policyNo}
        [HttpGet("product/wm")]
        public async Task<IActionResult> GetWmProduct([FromQuery] string? id, [FromQuery] string? policyNo)
        {
            if (string.IsNullOrEmpty(policyNo))
            {
                return BadRequest(new { status = 400, message = "Bad Request.", detail = "Parameter 'policyNo' is required." });
            }

            var path = $"v1/product/wm?id={Uri.EscapeDataString(id ?? "")}&policyNo={Uri.EscapeDataString(policyNo)}";
            var res = await _crmProxy.ProxyGetAsync(path, HttpContext.RequestAborted);
            if (!res.IsSuccess)
            {
                return StatusCode(res.StatusCode, res.Content);
            }

            try
            {
                using var doc = JsonDocument.Parse(res.Content);
                var root = doc.RootElement;
                if (root.TryGetPropertyCaseInsensitive("data", out var dataProp) && dataProp.ValueKind != JsonValueKind.Null)
                {
                    var product = CrmMapper.Map<WmProduct>(dataProp);
                    return Ok(new { status = 200, data = product });
                }
                return NotFound(new { status = 404, message = "Not Found", detail = $"No wealth management product found for policy number '{policyNo}'." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/unittrust?nric={nric}&accountNo={accountNo}
        [HttpGet("product/unittrust")]
        public async Task<IActionResult> GetUnitTrustProducts([FromQuery] string? nric, [FromQuery] string? accountNo)
        {
            var path = $"v1/product/unittrust?nric={Uri.EscapeDataString(nric ?? "")}&accountNo={Uri.EscapeDataString(accountNo ?? "")}";
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
                    var products = CrmMapper.MapList<UnitTrustProduct>(dataProp);
                    return Ok(new { status = 200, data = products });
                }

                return Ok(new { status = 200, data = new List<UnitTrustProduct>() });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }

        // GET /v1/product/willwriting?nric={nric}&accountNo={accountNo}
        [HttpGet("product/willwriting")]
        public async Task<IActionResult> GetWillWritingProducts([FromQuery] string? nric, [FromQuery] string? accountNo)
        {
            var path = $"v1/product/willwriting?nric={Uri.EscapeDataString(nric ?? "")}&accountNo={Uri.EscapeDataString(accountNo ?? "")}";
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
                    var products = CrmMapper.MapList<WillWritingProduct>(dataProp);
                    return Ok(new { status = 200, data = products });
                }

                return Ok(new { status = 200, data = new List<WillWritingProduct>() });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = 500, message = "JSON Mapping Error", detail = ex.Message });
            }
        }
    }
}
