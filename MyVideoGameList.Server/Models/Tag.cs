namespace MyVideoGameList.Server.Models;

/// <summary>
/// A word one user files their games under — "co-op", "comfort", "with Sam" — and nobody else's.
/// </summary>
/// <remarks>
/// <para>
/// Per account, not a global vocabulary (#135). Two people's "short" are two rows that know nothing of
/// each other, which is what lets a tag be free text with no moderation question attached: it is shown
/// to its owner and to nobody else — never on a public profile, a community view or the sitemap. See
/// <c>docs/decisions/0065-tags-are-the-owners-own-words.md</c>.
/// </para>
/// <para>
/// Not a status and not a list. A game carries any number of tags at once and moving between them has
/// no <em>from</em>, so a tag change writes no <see cref="UserGameEvent"/> (ADR 0018). When a tag was put
/// on a game is <see cref="UserGameEntryTag.AddedAt"/>, which is the whole of its history, as
/// <c>AddedAt</c> is the wishlist's (ADR 0022).
/// </para>
/// </remarks>
public class Tag
{
    public int Id { get; set; }

    public required string UserId { get; set; }

    /// <summary>As the owner wrote it, once <see cref="TagNamePolicy.Normalise"/> has tidied it.</summary>
    public required string Name { get; set; }

    /// <summary>
    /// <see cref="Name"/> folded by <see cref="TagNamePolicy.Key"/>, and the column the unique index is
    /// on, together with <see cref="UserId"/>.
    /// </summary>
    /// <remarks>
    /// "Co-op" and "co-op" are one tag, so the index cannot be over <see cref="Name"/>: it would hold
    /// only the spelling, and two requests creating the two spellings at once would both get in. Review
    /// found exactly that on <see cref="ShowcaseName"/> (#167), and Identity keeps a username unique the
    /// same way, over <c>NormalizedUserName</c>.
    /// </remarks>
    public required string NormalizedName { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
}

/// <summary>
/// One of the owner's tags on one of the owner's games.
/// </summary>
/// <remarks>
/// <para>
/// It carries its own <see cref="UserId"/> for the reason a playthrough does (ADR 0025 §3): the ownership
/// guard, <c>UserOwnedDataTests</c>, finds a user's tables by that column, so a link reached only
/// through its entry would escape the cascade check and the export manifest without failing anything.
/// </para>
/// <para>
/// And it reaches <em>both</em> of its parents through that column — the entry by
/// <c>(UserGameEntryId, UserId)</c> and the tag by <c>(TagId, UserId)</c> — so "the tag's owner is the
/// game's owner" is a database constraint. A link from one account's game to another account's tag is
/// refused by PostgreSQL, not by a service remembering to check, though <c>TagService</c> checks too so
/// that the refusal is a sentence beside the field rather than a 500.
/// </para>
/// </remarks>
public class UserGameEntryTag
{
    public required string UserId { get; set; }

    public int UserGameEntryId { get; set; }

    public int TagId { get; set; }

    /// <summary>
    /// When the tag was put on the game. A write of the whole set that leaves this tag where it was
    /// leaves this alone, which is why that write is a diff rather than a delete and a re-insert.
    /// </summary>
    public DateTimeOffset AddedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public UserGameEntry Entry { get; set; } = null!;
    public Tag Tag { get; set; } = null!;
}
