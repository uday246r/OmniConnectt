namespace ProductMarketplace.Application.Dtos;

public class ReviewDto
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public int Rating { get; set; }
    public string Comment { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class ReviewCreateDto
{
    public Guid ProductId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public int Rating { get; set; }
    public string Comment { get; set; } = string.Empty;
}

public class ReviewStatusUpdateDto
{
    public string Status { get; set; } = string.Empty;
}

public class ReviewQueryDto
{
    public string? Search { get; set; }
    public Guid? ProductId { get; set; }
    public string? Status { get; set; }
    public int? Rating { get; set; }
    private int _page = 1;
    private int _pageSize = 10;

    /// <summary>1 or greater; anything lower is read as the first page rather than failing with a negative offset.</summary>
    public int Page { get => _page; set => _page = value < 1 ? 1 : value; }

    /// <summary>Between 1 and <see cref="Common.Paging.MaxPageSize"/>, so no caller can ask for the whole table in one response.</summary>
    public int PageSize { get => _pageSize; set => _pageSize = Common.Paging.Clamp(value, 10); }
}
