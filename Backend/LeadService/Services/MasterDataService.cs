using Microsoft.EntityFrameworkCore;
using LeadManagement.Api.Data;
using LeadManagement.Api.Models.Dtos;

namespace LeadManagement.Api.Services
{
    public interface IMasterDataService
    {
        Task<List<DropdownOptionDto>> GetStatesAsync();
        Task<List<DropdownOptionDto>> GetBranchesAsync(string? stateName, string? query);
        Task<List<DropdownOptionDto>> GetSalesExecutivesAsync(string? query);
        Task<ReferenceDataDto> GetReferenceDataAsync();
    }

    public class MasterDataService : IMasterDataService
    {
        private readonly ApplicationDbContext _db;

        public MasterDataService(ApplicationDbContext db)
        {
            _db = db;
        }

        public async Task<List<DropdownOptionDto>> GetStatesAsync()
        {
            return await _db.States
                .OrderBy(s => s.Name)
                .Select(s => new DropdownOptionDto
                {
                    Value = s.Name,
                    Label = s.Name
                })
                .ToListAsync();
        }

        public async Task<List<DropdownOptionDto>> GetBranchesAsync(string? stateName, string? query)
        {
            var q = _db.Branches.AsNoTracking().Where(b => b.IsActive);

            if (!string.IsNullOrWhiteSpace(stateName))
            {
                var stateNameUpper = stateName.Trim().ToUpper();
                q = q.Where(b => b.State != null && b.State.Name.ToUpper() == stateNameUpper);
            }

            if (!string.IsNullOrWhiteSpace(query))
            {
                var search = query.Trim().ToLower();
                q = q.Where(b => b.Name.ToLower().Contains(search) || b.Code.ToLower().Contains(search));
            }

            return await q.OrderBy(b => b.Name)
                .Select(b => new DropdownOptionDto
                {
                    Value = b.Name,
                    Label = b.Name
                })
                .ToListAsync();
        }

        public async Task<List<DropdownOptionDto>> GetSalesExecutivesAsync(string? query)
        {
            var q = _db.SalesExecutives.AsNoTracking().Where(se => se.IsActive);

            if (!string.IsNullOrWhiteSpace(query))
            {
                var search = query.Trim().ToLower();
                q = q.Where(se => se.Name.ToLower().Contains(search) || se.StaffId.ToLower().Contains(search));
            }

            return await q.OrderBy(se => se.Name)
                .Select(se => new DropdownOptionDto
                {
                    Value = se.Name,
                    Label = se.Name
                })
                .ToListAsync();
        }

        public async Task<ReferenceDataDto> GetReferenceDataAsync()
        {
            var propertyTypes = await _db.PropertyTypes
                .OrderBy(p => p.Name)
                .Select(p => new DropdownOptionDto { Value = p.Name, Label = p.Name })
                .ToListAsync();

            var propertyStatuses = await _db.PropertyStatuses
                .OrderBy(p => p.Name)
                .Select(p => new DropdownOptionDto { Value = p.Name, Label = p.Name })
                .ToListAsync();

            var entityTypes = await _db.EntityTypes
                .OrderBy(e => e.Name)
                .Select(e => new DropdownOptionDto { Value = e.Name, Label = e.Name })
                .ToListAsync();

            return new ReferenceDataDto
            {
                PropertyTypes = propertyTypes,
                PropertyStatuses = propertyStatuses,
                EntityTypes = entityTypes
            };
        }
    }
}
