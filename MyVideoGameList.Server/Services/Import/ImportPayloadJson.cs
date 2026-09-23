using System.Text.Json;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// How a canonical row is stored in <c>ImportRow.Payload</c>.
/// </summary>
/// <remarks>
/// camelCase, so that the copy the data export emits reads like the rest of that document rather
/// than being the one section in PascalCase. One shared instance, because a
/// <c>JsonSerializerOptions</c> caches its type metadata on first use and a per-call one throws
/// that away — which for a 600-row import is 600 times.
/// </remarks>
internal static class ImportPayloadJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string Write(ImportRowPayload payload) =>
        JsonSerializer.Serialize(payload, Options);

    /// <summary>
    /// Reads a stored payload back. Throws if it is unreadable, which would mean this application
    /// wrote something it cannot read — a bug rather than bad user input, so it is not caught.
    /// </summary>
    public static ImportRowPayload Read(string payload) =>
        JsonSerializer.Deserialize<ImportRowPayload>(payload, Options)
        ?? throw new InvalidOperationException("An import row's stored payload was null.");
}
