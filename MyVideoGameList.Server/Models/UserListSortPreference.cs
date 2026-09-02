namespace MyVideoGameList.Server.Models;

/// <summary>
/// The sort keys a list view can be ordered by. Stored rather than acted on here — the sorting
/// itself happens client-side over an already-loaded list — but validated against this set so a
/// preference cannot be written that no client understands.
/// </summary>
public static class ListSortKeys
{
    /// <summary>When the game was first recorded. The default.</summary>
    public const string Added = "added";

    /// <summary>When the game last moved between lists.</summary>
    public const string StatusChanged = "status_changed";

    public const string Title = "title";
    public const string ReleaseDate = "release_date";

    /// <summary>The user's own score.</summary>
    public const string Score = "score";

    /// <summary>IGDB's blended critic-and-user score.</summary>
    public const string Rating = "rating";

    /// <summary>IGDB's critics-only aggregate.</summary>
    public const string CriticScore = "critic_score";
}

/// <summary>How a list view is laid out.</summary>
public static class ListViewModes
{
    public const string Tiles = "tiles";
    public const string Table = "table";
}

/// <summary>
/// How one user wants one status list sorted. Absent means the default — newest first — so a user
/// who has never changed a sort has no rows here at all.
/// </summary>
/// <remarks>
/// A row per (user, status) rather than a JSON blob on the user, matching
/// <see cref="UserHiddenPlatform"/>: it keeps the preference relational and queryable, and adding a
/// sixth status needs no migration because a missing row already means "use the default".
/// </remarks>
public class UserListSortPreference
{
    public required string UserId { get; set; }

    /// <summary>The status list this sort applies to.</summary>
    public short StatusId { get; set; }

    /// <summary>One of <see cref="ListSortKeys"/>.</summary>
    public required string SortKey { get; set; }

    public bool Descending { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ListStatus Status { get; set; } = null!;
}
