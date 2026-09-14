using System;
using System.Text.Json.Serialization;

namespace backend.Models
{
    public class AuditLog
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = Guid.NewGuid().ToString();

        /// <summary>
        /// A real instant, in UTC.
        ///
        /// This was a <c>string</c> holding <c>DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")</c> — the
        /// server's LOCAL wall clock, with no offset recorded — and rows were ordered by sorting that
        /// text. Two consequences made it unusable as an audit timestamp: a range filter was
        /// impossible to express (which is why this service's audit API accepted no date filter at
        /// all, alone among the platform's log surfaces), and a deployment in a different timezone,
        /// or either side of a DST change, silently interleaved rows out of chronological order while
        /// still looking perfectly sorted.
        /// </summary>
        [JsonPropertyName("timestamp")]
        public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;

        [JsonPropertyName("user")]
        public string User { get; set; } = string.Empty;

        /// <summary>
        /// The user id behind <see cref="User"/> when the token carried a parseable <c>sub</c>.
        /// Nullable because the display name is resolved from several claims and only one of them is
        /// an id — a row is never dropped for want of it.
        /// </summary>
        [JsonPropertyName("userId")]
        public Guid? UserId { get; set; }

        [JsonPropertyName("action")]
        public string Action { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = "Success";

        [JsonPropertyName("customerName")]
        public string? CustomerName { get; set; }

        [JsonPropertyName("customerType")]
        public string? CustomerType { get; set; }

        [JsonPropertyName("customerId")]
        public string? CustomerId { get; set; }

        [JsonPropertyName("field")]
        public string? Field { get; set; }
    }
}
