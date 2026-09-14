namespace ProductMarketplace.Application.Dtos;

public class EmploymentTypeDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool Active { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class EmploymentTypeCreateUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public bool Active { get; set; } = true;
    public int SortOrder { get; set; } = 1;
}
