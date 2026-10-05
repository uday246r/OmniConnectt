namespace ProductMarketplace.Application.Dtos;

/// <summary>A category that has at least one product the catalogue currently shows.</summary>
public class CatalogCategoryLookupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public int ProductCount { get; set; }
}

/// <summary>A sub-category the catalogue shows (live, under a live category).</summary>
public class CatalogSubCategoryLookupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryCode { get; set; } = string.Empty;
}

/// <summary>A product as another service (Lead Management) needs it: enough to show, to pick and to snapshot.</summary>
public class CatalogProductLookupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public Guid SubCategoryId { get; set; }
    public string SubCategoryName { get; set; } = string.Empty;
    public string SubCategoryCode { get; set; } = string.Empty;
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryCode { get; set; } = string.Empty;
}
