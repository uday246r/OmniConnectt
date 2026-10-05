namespace ProductMarketplace.Application.Common;

/// <summary>
/// A product's attribute values broke their sub-category's field definitions, reported per field.
/// </summary>
/// <remarks>
/// It is an <see cref="InvalidOperationException"/> so anything that already treats "the domain refused
/// this" as a 400 keeps working, and it carries every failing field at once rather than the first, so a
/// form can mark them all instead of making a person fix one and find the next on the following submit.
/// </remarks>
public sealed class FieldValidationException : InvalidOperationException
{
    /// <summary>Failing field key → the message to show against it.</summary>
    public IReadOnlyDictionary<string, string> Errors { get; }

    public FieldValidationException(IReadOnlyDictionary<string, string> errors)
        : base(errors.Count == 1 ? errors.Values.First() : $"{errors.Count} fields need attention: {string.Join(" ", errors.Values)}")
    {
        Errors = errors;
    }
}
