namespace ProductMarketplace.Application.Dtos;

public class ApplicationListItemDto
{
    public Guid Id { get; set; }
    public string ApplicationNumber { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class ApplicationFieldValueDto
{
    public string FieldKey { get; set; } = string.Empty;
    public string FieldLabel { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public class ApplicationDocumentDto
{
    public Guid Id { get; set; }
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; }
    public bool Uploaded { get; set; }
    public string? FileName { get; set; }
    public DateTime? UploadedAt { get; set; }
    public string? ContentType { get; set; }
    public long? FileSizeBytes { get; set; }
}

public class ApplicationStatusHistoryDto
{
    public string Status { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public DateTime ChangedAt { get; set; }
}

public class ApplicationDetailDto : ApplicationListItemDto
{
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public DateOnly? CustomerDateOfBirth { get; set; }
    public string ReviewNotes { get; set; } = string.Empty;
    public string ProductIconKey { get; set; } = string.Empty;
    public List<ApplicationFieldValueDto> FieldValues { get; set; } = new();
    public List<ApplicationDocumentDto> Documents { get; set; } = new();
    public List<ApplicationStatusHistoryDto> StatusHistory { get; set; } = new();
}

public class ApplicationFieldValueInputDto
{
    public Guid? FieldDefinitionId { get; set; }
    public string FieldKey { get; set; } = string.Empty;
    public string FieldLabel { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public class ApplicationCreateDto
{
    public Guid ProductId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public DateOnly? CustomerDateOfBirth { get; set; }
    public List<ApplicationFieldValueInputDto> FieldValues { get; set; } = new();
    public List<string> RequiredDocuments { get; set; } = new();
    /// <summary>When true the application is created directly as Submitted; otherwise stays Draft.</summary>
    public bool Submit { get; set; } = true;
}

public class ApplicationStatusUpdateDto
{
    public string Status { get; set; } = string.Empty;
    public string? Note { get; set; }
}

public class ApplicationQueryDto
{
    public string? Search { get; set; }
    public Guid? ProductId { get; set; }
    public string? Status { get; set; }
    private int _page = 1;
    private int _pageSize = 10;

    /// <summary>1 or greater; anything lower is read as the first page rather than failing with a negative offset.</summary>
    public int Page { get => _page; set => _page = value < 1 ? 1 : value; }

    /// <summary>Between 1 and <see cref="Common.Paging.MaxPageSize"/>, so no caller can ask for the whole table in one response.</summary>
    public int PageSize { get => _pageSize; set => _pageSize = Common.Paging.Clamp(value, 10); }
}
