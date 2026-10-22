using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What an account may call itself on its public profile, beside its handle.
/// </summary>
/// <remarks>
/// <para>
/// A display name is not a namespace claim, which is what makes these rules so much looser than
/// <see cref="UserNamePolicy"/>'s (ADR 0027): it is never unique, never looked up and never in a URL,
/// so spaces, punctuation, accents and emoji are all fine, and two accounts may share one. The handle
/// is what identifies an account, and it is shown beside the display name wherever an account is
/// identified, never replaced by it.
/// </para>
/// <para>
/// So the reserved list does not apply either. A display name reading "Support" sits beside
/// <c>@carol</c>, which says who is speaking; refusing a list of words in free text would not stop
/// "Support Team" or "S u p p o r t", and the handle already does. What is refused instead is what
/// would let a name pass for a handle, or rearrange the one beside it — see <see cref="Problem"/>.
/// </para>
/// <para>
/// The rest of the shape is <see cref="ListNamePolicy"/>'s: trimmed, every run of whitespace one
/// space, and nothing left in the control range. A blank means "no display name". ADR 0056.
/// </para>
/// </remarks>
public static partial class DisplayNamePolicy
{
    /// <summary>
    /// Room for a full name in most of the world's naming conventions, and short enough to sit beside
    /// a twenty-character handle in a profile's header. Counted in UTF-16 code units, as the client's
    /// <c>maxlength</c> counts it, so the two agree.
    /// </summary>
    public const int MaxLength = 50;

    /// <summary>
    /// The name as it will be stored: trimmed, with every run of whitespace inside it one space. Null
    /// for a name that is nothing but whitespace, which clears it.
    /// </summary>
    public static string? Normalise(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Whitespace().Replace(name.Trim(), " ");
    }

    /// <summary>Why a normalised name cannot be used, or null when it can.</summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A display name can be at most {MaxLength} characters.";

        // Whitespace has already been folded into spaces, so anything left in the control range is a
        // character with no business in a name — a NUL, a bell — rather than a stray line break.
        if (normalised.Any(char.IsControl))
            return "A display name cannot contain control characters.";

        // A handle is written "@carol" everywhere the site shows one, so a name holding "@ChronosSF"
        // would pass for somebody else's handle beside the real one — in the profile's heading, and in
        // a title read in a tab too narrow to show what follows it.
        if (normalised.Contains('@'))
            return "A display name cannot contain @, which is how a username is written here.";

        // The name is set into text beside the handle — the page's title, a share card's — where
        // nothing isolates it, and an unclosed override reverses whatever follows it: "(carol)" would
        // read backwards. Text in any script lays itself out without these, so a name never needs one.
        if (normalised.Any(IsDirectionalFormatting))
            return "A display name cannot contain characters that change the direction of the text around it.";

        return null;
    }

    /// <summary>
    /// The explicit embeddings, overrides and isolates — U+202A to U+202E and U+2066 to U+2069 —
    /// which reorder text beyond themselves. The implicit marks (LRM, RLM, ALM) only nudge their
    /// neighbours and stay allowed. Written as numbers so the source holds no invisible character.
    /// </summary>
    internal static bool IsDirectionalFormatting(char c) =>
        c is >= (char)0x202A and <= (char)0x202E or >= (char)0x2066 and <= (char)0x2069;

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
