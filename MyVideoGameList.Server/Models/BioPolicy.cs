using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What an account may say about itself on its public profile: a few lines of plain text.
/// </summary>
/// <remarks>
/// <para>
/// <b>Plain text, and that is a property of how it is rendered rather than of what is refused.</b>
/// The bio is written into the page as a text node and never parsed as markup, so <c>&lt;b&gt;</c>
/// shows as those three characters and "a &lt; b" is a perfectly good sentence — refusing angle
/// brackets would refuse the second to guard against the first, which cannot happen. Nothing is
/// linked or formatted either.
/// </para>
/// <para>
/// The whitespace inside it is the owner's: line breaks, runs of spaces and tabs are kept and shown
/// as written. Three things are tidied, none of which anybody means to publish. Line endings are
/// stored as one <c>\n</c> whichever a browser sent, so a limit counted over the stored text does not
/// charge two characters for a line break typed in one. A run of blank lines is one blank line, so
/// five hundred line breaks cannot push a profile's figures a screen-height down. And the ends are
/// trimmed. ADR 0056.
/// </para>
/// </remarks>
public static partial class BioPolicy
{
    /// <summary>
    /// A paragraph or two: enough to say what you play and how, and short enough that a profile
    /// opens with the person rather than with their essay. Counted in UTF-16 code units, as the
    /// client's <c>maxlength</c> counts it.
    /// </summary>
    public const int MaxLength = 500;

    /// <summary>
    /// The bio as it will be stored: every line ending a <c>\n</c>, no more than one blank line in a
    /// row, trimmed at both ends, and everything else kept exactly as written. Null for nothing but
    /// whitespace, which clears it.
    /// </summary>
    public static string? Normalise(string? bio)
    {
        if (string.IsNullOrWhiteSpace(bio)) return null;

        var lineFeeds = bio.Replace("\r\n", "\n").Replace('\r', '\n');
        return BlankLines().Replace(lineFeeds, "\n\n").Trim();
    }

    /// <summary>Why a normalised bio cannot be used, or null when it can.</summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A bio can be at most {MaxLength} characters.";

        // A line break and a tab are text; a NUL, an escape or a bell is not, and has no business in
        // something rendered on a public page.
        if (normalised.Any(c => char.IsControl(c) && c is not '\n' and not '\t'))
            return "A bio can contain line breaks and tabs, but no other control characters.";

        return null;
    }

    /// <summary>
    /// A line break followed by two or more lines holding nothing but spaces and tabs: more than one
    /// blank line in a row.
    /// </summary>
    [GeneratedRegex(@"\n(?:[ \t]*\n){2,}")]
    private static partial Regex BlankLines();
}
