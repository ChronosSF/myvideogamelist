using System.Security.Cryptography;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What a profile's public id is: the part of <c>/u/{publicId}/{userName}</c> that is looked up, and
/// the only part that never changes (ADR 0096).
/// </summary>
/// <remarks>
/// <para>
/// <b>Random, not sequential</b>, so that an id says nothing about how many accounts there are or in
/// what order they came. <b>Never Identity's account id</b>, which the confirmation and reset links
/// carry (ADR 0089, 0090): a value printed on every public page must not be one of the two halves of a
/// link that changes an account.
/// </para>
/// <para>
/// <b>"Never reused" rests on the length, not on a record of the ids that were.</b> A new id cannot be
/// one a live account holds: registration draws again until it is free, and the unique index refuses
/// it anyway. It could be one a deleted account held, since nothing remembers those, and an old link
/// to that account would then lead to the new one. At thirty symbols and twelve places there are
/// 30^12, about 5.3 × 10^17, ids. Even if every account the site ever makes were deleted, the chance
/// that any of ten million registrations draws a deleted account's id is at most ten million squared
/// over that, about 1 in 5,000; at a million accounts, 1 in 500,000. ADR 0096 sets out the sum.
/// </para>
/// <para>
/// <b>No vowels, and no <c>l</c></b>, so that no id spells a word in a link somebody shares, and none
/// mixes up <c>l</c> and <c>1</c> for somebody copying one by hand. Lower case only, so that an id is
/// one string however it is read back. A username may be the same string as somebody's id, since the
/// alphabets overlap, and that changes nothing: a username is never looked up.
/// </para>
/// <para>
/// The column's check constraint is built from <see cref="Alphabet"/> and <see cref="Length"/>, and
/// the client restates both for the shape it checks before asking (<c>@/lib/profilePath</c>), which
/// <c>serverMirrors.test.ts</c> holds equal to these.
/// </para>
/// </remarks>
public static class PublicIdPolicy
{
    /// <summary>How many characters every id has, exactly.</summary>
    public const int Length = 12;

    /// <summary>The digits and the lower-case consonants but <c>l</c>: thirty symbols.</summary>
    public const string Alphabet = "0123456789bcdfghjkmnpqrstvwxyz";

    /// <summary>
    /// A new id, drawn from the operating system's cryptographic generator, each symbol equally likely.
    /// Whether it is free is the caller's question (<see cref="Services.UserNameClaimService"/>).
    /// </summary>
    public static string New() => RandomNumberGenerator.GetString(Alphabet, Length);

    /// <summary>
    /// Whether a string could be an id at all: the length, and nothing outside the alphabet. A route
    /// value that is not one is answered as an id nobody holds, without a query.
    /// </summary>
    public static bool IsWellFormed(string? value)
    {
        if (value is null || value.Length != Length) return false;
        foreach (var character in value)
        {
            if (!Alphabet.Contains(character)) return false;
        }

        return true;
    }

    /// <summary>
    /// The column's check: every row's id is well formed, as the database sees it. A POSIX character
    /// class of the alphabet's own characters, so it says exactly what <see cref="IsWellFormed"/> says.
    /// </summary>
    internal static string CheckConstraintSql => $"\"PublicId\" ~ '^[{Alphabet}]{{{Length}}}$'";

    /// <summary>
    /// The column's default: a function the migration that added the column creates, which draws an id
    /// of this shape with PostgreSQL's <c>random()</c>, a new one for each row. Only a row the
    /// application did not write gets one, and none of those needs the cryptographic generator: an id
    /// is public, and what its randomness hides is only the order accounts came in.
    /// </summary>
    internal const string DatabaseDefaultSql = "new_public_id()";
}
