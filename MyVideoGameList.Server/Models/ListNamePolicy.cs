using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What a user may call one of their lists.
/// </summary>
/// <remarks>
/// <para>
/// Much looser than <see cref="UserNamePolicy"/>, because a list name is not a namespace claim: it is
/// shown to nobody but its owner, is never in a URL, and has no reason to be unique across accounts.
/// Spaces, punctuation and emoji are all fine.
/// </para>
/// <para>
/// Two rules remain. A name has to fit where list names are drawn — a tab, a chip in the game page's
/// sidebar, a button on a card's overlay — and the five names one user has must be told apart, so no
/// two may be the same when compared without case. The second includes the defaults: renaming Dropped
/// to "Playing" while Playing keeps its name would leave two buttons nobody could tell apart.
/// </para>
/// </remarks>
public static partial class ListNamePolicy
{
    /// <summary>
    /// Three times the longest default, which is room for "Pile of Shame" and "Beaten, finally" and
    /// still fits a tab at a phone's width.
    /// </summary>
    public const int MaxLength = 24;

    /// <summary>
    /// The name as it will be stored: trimmed, with every run of whitespace inside it one space. Null
    /// for a name that is nothing but whitespace, which means "use the default".
    /// </summary>
    public static string? Normalise(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Whitespace().Replace(name.Trim(), " ");
    }

    /// <summary>
    /// Why a normalised name cannot be used, or null when it can. Uniqueness is not checked here: it
    /// depends on the other four names, which the caller has.
    /// </summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A list name can be at most {MaxLength} characters.";

        // Whitespace has already been folded into spaces, so anything left in the control range is a
        // character with no business in a label — a NUL, a bell — rather than a stray line break.
        if (normalised.Any(char.IsControl))
            return "A list name cannot contain control characters.";

        return null;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
