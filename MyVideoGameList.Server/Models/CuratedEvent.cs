namespace MyVideoGameList.Server.Models;

/// <summary>
/// What a curated event is, which decides how the two-week line and the calendar draw it.
/// </summary>
/// <remarks>
/// Closed, and held to that by a check constraint as well as by the API: a row of a kind the client
/// has never heard of would be drawn as nothing at all, which is worse than being refused on the way
/// in. A fourth kind is a constant, a migration and a label on the client, together.
/// </remarks>
public static class CuratedEventKinds
{
    /// <summary>A store-wide sale — Steam's seasonal ones, Epic's, a console store's.</summary>
    public const string Sale = "sale";

    /// <summary>
    /// An event that is not a sale, though games in it may be discounted. Steam's Next Fest is the
    /// one entered by default (spec §6, S2).
    /// </summary>
    public const string Fest = "fest";

    /// <summary>A showcase IGDB does not have yet (spec §5, E2).</summary>
    public const string Showcase = "showcase";
}

/// <summary>
/// The stores a curated event can belong to: the six whose sale announcements spec §6 checked.
/// </summary>
/// <remarks>
/// Closed at the API and open in the database, the reverse of <see cref="CuratedEventKinds"/>. The
/// store is a label rather than something the calendar branches on, so a row naming one the client
/// does not know still draws, and adding a store then needs no migration.
/// </remarks>
public static class CuratedEventStores
{
    public const string Steam = "steam";
    public const string Epic = "epic";
    public const string PlayStation = "playstation";
    public const string Xbox = "xbox";
    public const string Nintendo = "nintendo";
    public const string Gog = "gog";
}

/// <summary>
/// A date on the release calendar that nobody publishes in a form a program can read, entered by
/// hand on the admin page: a store's sale, Steam's Next Fest, a showcase IGDB has not caught up with.
/// </summary>
/// <remarks>
/// <para>
/// Reference data rather than anybody's data. It carries no <c>UserId</c> — not even one recording
/// who entered it — because <c>UserOwnedDataTests</c> recognises a user's data by that column, and
/// would demand a cascade from the account and an export section for rows that belong to nobody
/// (spec §7, A5).
/// </para>
/// <para>
/// Days, not instants (S3). Steam's sales start at ten in the morning Pacific and PlayStation's in
/// each region's own time, so the one resolution that is true everywhere is the day — shown as the
/// day it names, with no timezone conversion, exactly as a release date is.
/// </para>
/// </remarks>
public class CuratedEvent
{
    public const int NameMaxLength = 120;

    /// <summary>
    /// Long enough for a forum thread's address with its slug, which is the longest a source in
    /// spec §10 needed.
    /// </summary>
    public const int UrlMaxLength = 512;

    public int Id { get; set; }

    /// <summary>One of <see cref="CuratedEventKinds"/>.</summary>
    public required string Kind { get; set; }

    /// <summary>One of <see cref="CuratedEventStores"/>, or null for an event no store runs.</summary>
    public string? Store { get; set; }

    /// <summary>What it was announced as — "Steam Autumn Sale".</summary>
    public required string Name { get; set; }

    public DateOnly StartsOn { get; set; }

    /// <summary>The last day, inclusive: a one-day event starts and ends on the same day.</summary>
    public DateOnly EndsOn { get; set; }

    /// <summary>
    /// Where the dates were announced. Required, because a date typed in by hand is only as good as
    /// the page it was copied from, and whoever doubts it later has to be able to find that page.
    /// </summary>
    public required string Url { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
