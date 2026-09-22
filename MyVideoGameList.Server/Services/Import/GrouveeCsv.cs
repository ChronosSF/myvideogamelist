using System.Globalization;
using System.Text.Json;
using CsvHelper;
using CsvHelper.Configuration;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Grouvee's CSV export, turned into the same document the JSON one deserialises to.
/// </summary>
/// <remarks>
/// <para>
/// Not a second importer. Grouvee offers both downloads from the same settings page and they were
/// verified to carry identical data — the CSV is the JSON with four of its columns serialised into
/// quoted strings. So this parses those four back out and hands
/// <see cref="GrouveeImportSource"/> the shape it already knows, and every mapping decision stays
/// in one place. A user who clicked the other button has not made a mistake worth an error message
/// (ADR 0037, decision 6).
/// </para>
/// <para>
/// The CSV does carry <em>less</em>: it is the collection alone, with no account section, no
/// top-level play log and no reviews list. That costs the handful of games those sections know
/// about and the collection does not, which is why the client recommends the JSON.
/// </para>
/// <para>
/// A real CSV library rather than splitting on commas, per `specs/csv-list-import.md` §S6 — the
/// nested columns are quoted JSON full of commas and doubled quotes, and review text may contain
/// newlines. Hand-rolled splitting corrupts all three.
/// </para>
/// </remarks>
internal static class GrouveeCsv
{
    private static readonly CsvConfiguration Configuration = new(CultureInfo.InvariantCulture)
    {
        // Their column set is wider than what we read, and it has grown before. Missing and extra
        // fields are both the parser's business rather than an error: a column we do not read
        // cannot break an import, and one we do read is checked for below.
        HeaderValidated = null,
        MissingFieldFound = null,
        TrimOptions = TrimOptions.Trim
    };

    /// <summary>The columns this reads. A file without them is not a Grouvee CSV.</summary>
    private static readonly string[] Required = ["name", "shelves", "dates"];

    public static GrouveeExport Read(string content)
    {
        using var reader = new StringReader(content);
        using var csv = new CsvReader(reader, Configuration);

        try
        {
            if (!csv.Read() || !csv.ReadHeader())
                throw new ImportParseException("That file has no header row, so it cannot be a Grouvee CSV.");

            var header = csv.HeaderRecord ?? [];
            var missing = Required
                .Where(column => !header.Contains(column, StringComparer.OrdinalIgnoreCase))
                .ToList();

            if (missing.Count > 0)
                throw new ImportParseException(
                    $"That CSV is missing the {string.Join(", ", missing)} column(s), so it does not look "
                    + "like a Grouvee export.");

            var games = new List<GrouveeGame>();
            while (csv.Read()) games.Add(ReadGame(csv));

            // The CSV has no version column, so it is taken at the version this code understands.
            // The required-column check above is what actually guards a reshaped file here.
            return new GrouveeExport { ExportFormatVersion = GrouveeImportSource.SupportedFormatVersion, Collection = games };
        }
        catch (CsvHelperException e)
        {
            throw new ImportParseException($"That CSV could not be read ({e.Message}).");
        }
    }

    private static GrouveeGame ReadGame(IReaderRow row) => new()
    {
        Id = Int(row, "id") ?? 0,
        Name = Text(row, "name"),
        IgdbId = Int(row, "igdb_id"),
        Rating = Decimal(row, "rating"),
        ReviewTitle = Text(row, "review_title"),
        Review = Text(row, "review"),
        ReleaseDate = Text(row, "release_date"),
        DateAddedToCollection = Text(row, "date_added_to_collection"),
        Shelves = Nested<Dictionary<string, JsonElement>>(row, "shelves"),
        Platforms = Nested<Dictionary<string, JsonElement>>(row, "platforms"),
        Dates = Nested<List<GrouveePlay>>(row, "dates")
    };

    private static string? Text(IReaderRow row, string column) =>
        row.TryGetField<string>(column, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    private static int? Int(IReaderRow row, string column) =>
        int.TryParse(Text(row, column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    private static decimal? Decimal(IReaderRow row, string column) =>
        decimal.TryParse(Text(row, column), NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    /// <summary>
    /// One of the four columns holding JSON. A cell we cannot parse leaves that one field empty
    /// rather than failing the row: the title and the id are what the import actually needs, and
    /// losing a shelf name is a smaller harm than losing the game.
    /// </summary>
    private static T? Nested<T>(IReaderRow row, string column) where T : class
    {
        var raw = Text(row, column);
        if (raw is null) return null;

        try
        {
            return JsonSerializer.Deserialize<T>(raw, GrouveeJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
