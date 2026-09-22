using System.Text.Json;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Grouvee's export document, as it is on the wire.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately a transcription rather than a design: the names, the nesting and the awkward types
/// are theirs. Everything that turns this into something we would have designed happens in
/// <see cref="GrouveeImportSource"/>, so that the two can be read against each other — and against
/// a real file — without one hiding the other.
/// </para>
/// <para>
/// Property names are mapped by <c>JsonNamingPolicy.SnakeCaseLower</c> rather than by an attribute
/// each. Dictionary <em>keys</em> are untouched by that, which is what the shelf and platform names
/// depend on: they arrive as <c>"PlayStation 3"</c> and must stay that way.
/// </para>
/// <para>
/// Only what the import reads is declared. The document also carries genres, franchises, series,
/// developers, publishers, URLs and a Giant Bomb id, all of which describe the <em>game</em> rather
/// than the user's relationship to it — and IGDB is our source of truth for games (ADR 0001), so
/// importing any of it would be copying a worse copy.
/// </para>
/// </remarks>
internal sealed class GrouveeExport
{
    public int ExportFormatVersion { get; set; }
    public GrouveeAccount? Account { get; set; }
    public List<GrouveeGame>? Collection { get; set; }

    /// <summary>
    /// Every recorded run, across every game. Mostly a second view of <see cref="GrouveeGame.Dates"/>,
    /// but not entirely — see <c>MergeOrphans</c>.
    /// </summary>
    public List<GrouveePlay>? PlayLog { get; set; }

    /// <summary>Every review and score, likewise mostly a second view of the collection's.</summary>
    public List<GrouveeReview>? Reviews { get; set; }
}

internal sealed class GrouveeAccount
{
    /// <summary>
    /// Left as raw JSON because its element shape has never been observed — it was empty in the
    /// only real export available. Read defensively; see <c>FavouriteIds</c>.
    /// </summary>
    public List<JsonElement>? FavoriteGames { get; set; }
}

internal sealed class GrouveeGame
{
    public string? Name { get; set; }

    /// <summary>IGDB's own id, which is what makes this preset need no matcher. Null on a handful of rows.</summary>
    public int? IgdbId { get; set; }

    /// <summary>Keyed by shelf name; the values are a URL and an ordinal we have no use for.</summary>
    public Dictionary<string, JsonElement>? Shelves { get; set; }

    /// <summary>
    /// Keyed by platform name, and the names are <em>IGDB's own</em> — "PC (Microsoft Windows)",
    /// "Sega Mega Drive/Genesis". A convenience rather than a contract, so it is used as a hint
    /// and never as a key (ADR 0037).
    /// </summary>
    public Dictionary<string, JsonElement>? Platforms { get; set; }

    /// <summary>Out of five, or null. Integers in practice; read as a decimal in case of halves.</summary>
    public decimal? Rating { get; set; }

    public string? ReviewTitle { get; set; }
    public string? Review { get; set; }

    /// <summary>Zero or more runs. Grouvee writes one empty row here whenever a game is shelved.</summary>
    public List<GrouveePlay>? Dates { get; set; }

    public string? ReleaseDate { get; set; }

    /// <summary>A true <c>AddedAt</c> — see <see cref="ImportRowPayload.AddedAt"/> for why that matters.</summary>
    public string? DateAddedToCollection { get; set; }
}

/// <summary>One row of the play log.</summary>
/// <remarks>
/// <see cref="DateStarted"/> and <see cref="DateFinished"/> are strings rather than dates because
/// absent ones are the literal text <c>"None"</c>; <see cref="GrouveeImportSource.DateOf"/> is the
/// only thing that should read them.
/// </remarks>
internal sealed class GrouveePlay
{
    public string? DateStarted { get; set; }
    public string? DateFinished { get; set; }

    /// <summary>Zero when unrecorded, which is not a duration.</summary>
    public long SecondsPlayed { get; set; }

    /// <summary>
    /// Read and deliberately never used. It is the field that would decide whether a run counts
    /// towards the community medians, and it is a default rather than a statement — declared here
    /// so that the next person to look for it finds this sentence instead of adding it.
    /// See <see cref="ImportPlaythroughPayload"/> and ADR 0037 decision 4.
    /// </summary>
    public string? LevelOfCompletion { get; set; }

    public string? Platform { get; set; }

    /// <summary>Set in the top-level play log, absent inside a collection entry.</summary>
    public GrouveeGameRef? Game { get; set; }
}

internal sealed class GrouveeReview
{
    public GrouveeGameRef? Game { get; set; }
    public string? Title { get; set; }
    public decimal? Rating { get; set; }
    public string? Text { get; set; }
}

/// <summary>How the play log and the reviews point back at a game.</summary>
internal sealed class GrouveeGameRef
{
    public string? Name { get; set; }
    public int? IgdbId { get; set; }
}
