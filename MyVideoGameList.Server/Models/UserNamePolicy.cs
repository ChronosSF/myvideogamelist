namespace MyVideoGameList.Server.Models;

/// <summary>
/// What a username may be. One place, because the same answer is needed by the registration
/// endpoint, the rename endpoint, Identity's own <c>UserValidator</c> and the migration that
/// backfilled the accounts that predate any of them.
/// </summary>
/// <remarks>
/// <para>
/// A username here is a <em>namespace claim</em>, not a display name: it is the whole of
/// <c>/u/{userName}</c>, so it has to be unique, stable, and unambiguous when read aloud or typed
/// from a screenshot. That rules out spaces, punctuation beyond the underscore, and any pair of
/// names distinguishable only by case.
/// </para>
/// <para>
/// Deliberately narrower than Identity's default alphabet, which also allows <c>@ . - +</c> and
/// would let a username look like an email address or collide with a URL segment. The two are kept
/// in step by <c>Program.cs</c>, which configures
/// <c>IdentityOptions.User.AllowedUserNameCharacters</c> from <see cref="AllowedCharacters"/> —
/// otherwise Identity would accept a name this class rejects, through any code path that does not
/// go through here.
/// </para>
/// </remarks>
public static class UserNamePolicy
{
    public const int MinLength = 3;

    /// <summary>
    /// Short enough to render in a navbar and to read back over a phone; long enough that most
    /// people get the name they wanted.
    /// </summary>
    public const int MaxLength = 20;

    /// <summary>
    /// The alphabet, in the form <see cref="Microsoft.AspNetCore.Identity.UserOptions"/> wants it —
    /// and the same string <see cref="Check"/> validates against, so the two cannot drift.
    /// </summary>
    public const string AllowedCharacters =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

    /// <summary>
    /// Names nobody may claim, compared case-insensitively.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Two kinds, and both matter. The first is every existing top-level route — a user called
    /// <c>games</c> is not a routing conflict today, because profiles live under <c>/u/</c>, but it
    /// becomes one the moment anybody suggests shortening that, and reserving the names now costs
    /// nothing while un-reserving one later costs somebody their profile.
    /// </para>
    /// <para>
    /// The second is names that would let one account impersonate the site to another — an
    /// <c>@admin</c> or a <c>@support</c> writing a review carries an authority it has not earned.
    /// That is the reason this list is worth keeping current rather than a nicety.
    /// </para>
    /// </remarks>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        // Routes, current and plausible.
        "u", "user", "users", "api", "games", "game", "lists", "list", "wishlist", "home",
        "search", "browse", "settings", "profile", "profiles", "login", "logout", "signin",
        "signout", "signup", "register", "account", "auth", "healthz", "readyz", "static",
        "assets", "public", "sitemap", "robots", "feed", "rss", "new", "edit", "delete",

        // Names that would speak for the site.
        "admin", "administrator", "moderator", "mod", "staff", "team", "support", "help",
        "security", "abuse", "legal", "billing", "official", "system", "root", "everyone",
        "myvideogamelist", "mvgl",

        // Names that read as an absence of one.
        "null", "undefined", "none", "anonymous", "deleted", "me"
    };

    /// <summary>Why a username was refused, or <see cref="Ok"/>.</summary>
    public enum Result
    {
        Ok,

        /// <summary>Wrong length, or characters outside <see cref="AllowedCharacters"/>.</summary>
        Malformed,

        /// <summary>Well-formed, but on the reserved list.</summary>
        Reserved
    }

    /// <summary>
    /// Checks a proposed username against the shape rules and the reserved list.
    /// </summary>
    /// <remarks>
    /// Says nothing about whether the name is <em>taken</em>: that is a question for the database
    /// and it can only be answered at the moment of writing. See
    /// <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
    /// </remarks>
    public static Result Check(string? userName)
    {
        if (userName is null || userName.Length is < MinLength or > MaxLength)
            return Result.Malformed;

        // Checked against the same string Identity is configured with rather than against a regex
        // saying the same thing twice. The two cannot disagree if there is only one of them, and a
        // disagreement here is the bug that lets a name into the namespace by a side door.
        foreach (var character in userName)
            if (!AllowedCharacters.Contains(character)) return Result.Malformed;

        return Reserved.Contains(userName) ? Result.Reserved : Result.Ok;
    }

    /// <summary>The sentence the person choosing the name reads. Written for them, not for a log.</summary>
    public static string Message(Result result) => result switch
    {
        Result.Malformed =>
            $"A username is {MinLength} to {MaxLength} characters, using letters, numbers and "
            + "underscores only.",
        Result.Reserved => "That username is reserved. Please choose another.",
        _ => string.Empty
    };
}
