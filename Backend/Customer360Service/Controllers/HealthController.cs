using backend.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    public class HealthController(IConfiguration configuration, Customer360DbContext db) : ControllerBase
    {
        // GET /health
        // Readiness endpoint for load balancers and monitoring systems.
        // Does NOT call the CRM API (that would generate real upstream traffic on every probe) and
        // never exposes secrets, configuration values, or customer data.
        //
        // It DOES verify this service can actually do its job — required configuration present AND the
        // database reachable. The database check is not optional: the comment here used to say "this
        // service has no database", which stopped being true when Customer360DbContext arrived to back
        // FieldConfigService and AuditRepository. Until this was added, an unreachable Customer360Db
        // reported healthy while /v1/field-config and /v1/audit both returned 500 — a load balancer
        // would keep routing traffic to an instance that could not serve it. Every other service in
        // the platform uses AddDbContextCheck for exactly this reason.
        [HttpGet("health")]
        public async Task<IActionResult> GetHealth(CancellationToken ct)
        {
            var missing = new List<string>();

            if (string.IsNullOrWhiteSpace(configuration["CrmApi:BaseUrl"])) missing.Add("CrmApi:BaseUrl");
            if (string.IsNullOrWhiteSpace(configuration["CrmApi:ClientId"])) missing.Add("CrmApi:ClientId");
            if (string.IsNullOrWhiteSpace(configuration["CrmApi:ClientSecret"])) missing.Add("CrmApi:ClientSecret");
            if (string.IsNullOrWhiteSpace(configuration["Jwt:SigningKeyPublic"])) missing.Add("Jwt:SigningKeyPublic");
            if (string.IsNullOrWhiteSpace(configuration.GetConnectionString("Customer360Db"))) missing.Add("ConnectionStrings:Customer360Db");

            if (missing.Count > 0)
            {
                return StatusCode(503, new { status = "unhealthy", missingConfiguration = missing });
            }

            // Reports the dependency as down without leaking the connection string, host, or the
            // provider's exception text — a health endpoint is typically the most publicly reachable
            // route on the service.
            if (!await db.Database.CanConnectAsync(ct))
            {
                return StatusCode(503, new { status = "unhealthy", dependency = "database" });
            }

            return Ok(new { status = "healthy" });
        }
    }
}
