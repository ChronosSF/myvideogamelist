using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// How Grouvee's JSON is read, shared by the document parser and by the CSV's nested cells.
/// </summary>
/// <remarks>
/// One instance rather than one per call site: a <c>JsonSerializerOptions</c> caches its type
/// metadata on first use, so constructing one per parse throws that away and reflects over every
/// type again.
/// </remarks>
internal static class GrouveeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        // Maps `IgdbId` to `igdb_id` and the rest, so the wire shapes need no attribute each.
        // Dictionary keys are untouched by this, which the shelf and platform names rely on.
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,

        // Their CSV quotes numbers that their JSON does not, and the same shapes read both.
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };
}
