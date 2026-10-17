using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What a tag may be called, and how many of them there may be.
/// </summary>
/// <remarks>
/// <para>
/// As loose as <see cref="ListNamePolicy"/> and for the same reason: a tag is shown to nobody but its
/// owner, is never in a URL and is nobody else's to read, so spaces, punctuation and emoji are all fine.
/// What is left is that it has to fit on a chip under a cover, and that one account's tags must be told
/// apart — no two the same when compared without case.
/// </para>
/// <para>
/// The caps bound what one account can make, not a fact the data depends on. Creates that are in flight
/// together at the limit can each land, as uploads can on the import's pending cap: the overshoot is as
/// many as one account has in flight at once, nothing reads the count, and a lock to prevent it is not
/// worth what it would cost every create.
/// </para>
/// </remarks>
public static partial class TagNamePolicy
{
    /// <summary>
    /// Room for "Couch co-op with the kids" and "Finish before the sequel", short enough for a chip
    /// under a cover. Counted in UTF-16 units, as every length here is, which is never fewer than the
    /// characters the column counts — so a name that passes always fits.
    /// </summary>
    public const int MaxLength = 30;

    /// <summary>
    /// Far past any vocabulary somebody actually keeps — the filter that lists them all is still usable
    /// at this size — and low enough that a script cannot fill the table.
    /// </summary>
    public const int MaxTagsPerAccount = 200;

    /// <summary>
    /// The most one game may carry. The whole set travels in one request, so this is also the bound on
    /// that request's work.
    /// </summary>
    public const int MaxTagsPerEntry = 20;

    /// <summary>
    /// Past this a name is refused before it is looked at, so that a megabyte of text costs a length
    /// check rather than a pass of the whitespace expression. Far above <see cref="MaxLength"/>, because
    /// spaces folded away by <see cref="Normalise"/> do not count against it.
    /// </summary>
    internal const int MaxRawLength = 1000;

    /// <summary>
    /// The name as it will be stored: composed to Unicode's NFC, trimmed, and with every run of
    /// whitespace inside it one space. Null for a name that is nothing but whitespace.
    /// </summary>
    /// <remarks>
    /// NFC because "café" typed with a combining accent and "café" pasted from somewhere else are two
    /// strings and one word, and two tags that look identical are worse than either. A string that is not
    /// well-formed UTF-16 — a lone surrogate, which JSON can carry — cannot be composed and is passed
    /// through as it is; <see cref="Problem"/> refuses it.
    /// </remarks>
    public static string? Normalise(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;

        var composed = IsWellFormed(name) ? name.Normalize(NormalizationForm.FormC) : name;
        return Whitespace().Replace(composed.Trim(), " ");
    }

    /// <summary>
    /// Why a normalised name cannot be used, or null when it can. Uniqueness is not checked here: it is a
    /// fact about the account's other tags, which the write that races for it has to settle.
    /// </summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A tag can be at most {MaxLength} characters.";

        // Whitespace is already folded into spaces, so anything left in the control range is a
        // character with no business in a label — a NUL, a bell — rather than a stray line break.
        if (normalised.Any(char.IsControl) || !IsWellFormed(normalised))
            return "A tag cannot contain control characters.";

        // An invisible formatting character — a zero-width space, a byte-order mark, a direction override —
        // would make a second "co-op" that looks exactly like the first, a chip with nothing on it, or the
        // text after it read backwards. The joiners stay, because emoji are built with them, and so do the
        // tag characters a subdivision's flag is spelt with.
        if (normalised.EnumerateRunes().Any(rune =>
                Rune.GetUnicodeCategory(rune) == UnicodeCategory.Format && !IsAllowedFormat(rune.Value)))
            return "A tag cannot contain invisible formatting characters.";

        // Joiners and spaces alone are still nothing to see.
        if (!normalised.EnumerateRunes().Any(rune =>
                !Rune.IsWhiteSpace(rune) && Rune.GetUnicodeCategory(rune) != UnicodeCategory.Format))
            return "A tag needs a name.";

        return null;
    }

    /// <summary>
    /// The formatting characters a name may carry: the zero-width non-joiner and joiner, which emoji
    /// sequences and some scripts need, and the tag characters that spell a flag such as England's.
    /// </summary>
    private static bool IsAllowedFormat(int codePoint) =>
        codePoint is 0x200C or 0x200D or (>= 0xE0020 and <= 0xE007F);

    /// <summary>
    /// The comparison key: the normalised name in upper case, as <see cref="ShowcaseName.Normalise"/> and
    /// Identity's lookup normaliser fold theirs. The one fold, so the check and the index cannot disagree.
    /// </summary>
    public static string Key(string normalised) => normalised.ToUpperInvariant();

    /// <summary>
    /// Every surrogate in its pair. <see cref="string.Normalize()"/> throws on one that is not, and a
    /// half of a character is nothing anybody typed.
    /// </summary>
    private static bool IsWellFormed(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsHighSurrogate(text[i]))
            {
                if (i + 1 >= text.Length || !char.IsLowSurrogate(text[i + 1])) return false;
                i++;
            }
            else if (char.IsLowSurrogate(text[i]))
            {
                return false;
            }
        }

        return true;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}

/// <summary>
/// Validates a proposed tag name against <see cref="TagNamePolicy"/>, so that <c>[ApiController]</c>
/// returns the 400 itself and the message lands beside the field.
/// </summary>
/// <remarks>
/// It answers "may this be a tag", never "is this name free" — that is a fact about the database at one
/// instant, and belongs to the write that races for it, as <see cref="UserNameAttribute"/> says of a
/// username.
/// </remarks>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter, AllowMultiple = false)]
public sealed class ValidTagNameAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        // Absence is [Required]'s question, not this one — answering it here too would put two
        // messages under one empty field. [Required] refuses a blank string as well as a null.
        if (value is null || (value is string text && string.IsNullOrWhiteSpace(text)))
            return ValidationResult.Success;

        var problem = Check(value as string);

        return problem is null
            ? ValidationResult.Success
            : new ValidationResult(problem, context.MemberName is null ? null : [context.MemberName]);
    }

    /// <summary>The sentence to show, or null for a name that may be used.</summary>
    internal static string? Check(string? raw)
    {
        if (raw is { Length: > TagNamePolicy.MaxRawLength })
            return $"A tag can be at most {TagNamePolicy.MaxLength} characters.";

        return TagNamePolicy.Normalise(raw) is { } normalised
            ? TagNamePolicy.Problem(normalised)
            : "A tag needs a name.";
    }
}
