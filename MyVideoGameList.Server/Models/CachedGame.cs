namespace MyVideoGameList.Server.Models;

/// <summary>
/// One IGDB game as this app last saw it, so that a page about somebody's own library renders
/// when IGDB does not answer.
/// </summary>
/// <remarks>
/// <para>
/// The key is the IGDB id. There is no local game id and there will not be one: the last local
/// catalogue was nine tables whose <c>Platform</c> ids collided with IGDB's — local 6 meant Switch
/// where IGDB's 6 means PC — and it was deleted for that reason (ADR 0001).
/// </para>
/// <para>
/// The body is the mapped <c>GameDto</c> as JSON rather than a column per field. The purpose is to
/// render a game we have already shown, not to re-implement IGDB's schema: a document cannot
/// collide with anything, and a field IGDB adds needs no migration here. The four columns beside it
/// are extracted copies, for reading a shelf of games without deserialising every payload.
/// </para>
/// <para>
/// A row with a null <see cref="Payload"/> is a tombstone: IGDB had no such game when we last
/// asked. It exists so that an id nobody can resolve — a game withdrawn from IGDB but still on
/// somebody's list — is not asked about again on every page load.
/// </para>
/// <para>
/// Not user-owned, and deliberately so: it carries no <c>UserId</c>, is shared by every account,
/// and holds nothing anybody entered. It is therefore outside the ownership contract — no cascade
/// from <c>AspNetUsers</c> and no entry in the export manifest (ADR 0024). Deleting an account must
/// not delete the games it happened to be first to cache.
/// </para>
/// </remarks>
public class CachedGame
{
    /// <summary>The IGDB game id.</summary>
    public int GameId { get; set; }

    /// <summary>
    /// The mapped <c>GameDto</c> as JSON, or <c>null</c> when IGDB returned nothing for this id.
    /// </summary>
    /// <remarks>
    /// Always the listing shape, never the detail one: <c>GameDto.Details</c> is null here, as it
    /// is everywhere but the game page, which asks IGDB directly (ADR 0017).
    /// </remarks>
    public string? Payload { get; set; }

    /// <summary>The game's title, copied out of the payload.</summary>
    public string? Title { get; set; }

    /// <summary>The first release date, copied out of the payload.</summary>
    public DateOnly? ReleaseDate { get; set; }

    /// <summary>The cover art URL, copied out of the payload.</summary>
    public string? CoverImageUrl { get; set; }

    /// <summary>IGDB's player rating, copied out of the payload.</summary>
    public float? Rating { get; set; }

    /// <summary>
    /// When this row was last written from IGDB — including the writes that produced a tombstone,
    /// so a dead id is left alone for the same interval as a live one.
    /// </summary>
    public DateTimeOffset RefreshedAt { get; set; }
}
