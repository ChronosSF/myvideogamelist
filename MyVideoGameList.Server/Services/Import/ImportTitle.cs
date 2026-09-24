using System.Collections.Frozen;
using System.Globalization;
using System.Text;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Everything one title is compared on, derived in a single pass over it.
/// </summary>
/// <remarks>
/// Together rather than one call each, because all three come off the same token list and a title
/// is compared against twenty candidates — deriving them separately tokenised every string twice
/// and split it a third time for the numbers.
/// </remarks>
/// <param name="Key">
/// <see cref="ImportTitle.Normalise"/>'s output: the conservative key, and the only one an
/// automatic match may be decided on.
/// </param>
/// <param name="Loose">
/// <see cref="ImportTitle.WithoutEdition"/>'s output: the same with any trailing edition removed.
/// May offer a candidate and may never choose one.
/// </param>
/// <param name="Numbers">
/// The whole numbers in <paramref name="Key"/> — the single most useful signal a game title
/// carries, and the one a character-by-character similarity is worst at. "Dark Souls" and "Dark
/// Souls 3" differ by two characters out of twelve and are not the same game, while "FIFA 14" and
/// "FIFA 15" differ by one. So they are compared as a set rather than left to the score.
/// </param>
internal readonly record struct TitleKeys(string Key, string Loose, IReadOnlySet<int> Numbers);

/// <summary>
/// A game title reduced to something two services can be compared on, and to something IGDB can be
/// asked about. <c>specs/csv-list-import.md</c> §M1.
/// </summary>
/// <remarks>
/// <para>
/// Every method here is applied to <em>both</em> sides of a comparison — the row from the file and
/// the game IGDB answered with — which is what makes a transformation safe that would look reckless
/// applied to one. Folding <c>VII</c> to <c>7</c> cannot cause a mismatch, because a title spelled
/// either way arrives at the same string; it can only cause a <em>collision</em>, between two names
/// that differ by nothing else. That is the risk each rule below is weighed against.
/// </para>
/// <para>
/// <b>Two keys, not one, and the difference between them is the whole safety argument.</b> A wrong
/// automatic match writes a game its owner never played into their library, silently and probably
/// permanently; a missed match costs them a click on the review screen. So <see cref="Normalise"/>
/// is deliberately conservative and is the only key an automatic match may be decided on, while
/// <see cref="WithoutEdition"/> is generous and is only ever allowed to <em>offer</em> a candidate.
/// "Dark Souls Remastered" therefore matches "Dark Souls Remastered" outright and merely offers
/// "Dark Souls", rather than choosing between them on somebody's behalf.
/// </para>
/// </remarks>
internal static class ImportTitle
{
    /// <summary>
    /// The longest search term sent to IGDB. Past this a title is a paste accident rather than a
    /// name, and the query stays bounded whatever the file contains.
    /// </summary>
    private const int MaxSearchLength = 120;

    /// <summary>
    /// The highest roman numeral folded to digits.
    /// </summary>
    /// <remarks>
    /// Thirty, because this exists for sequel numbers and no series has reached that. The bound is
    /// not thrift — it is the guard. Every letter of a roman numeral is also an ordinary letter, so
    /// an unbounded fold turns real words into numbers: <c>MIX</c> is a canonical 1009 and
    /// <c>CIV</c> a canonical 104, and a rule that rewrote either would quietly corrupt every title
    /// containing them. Stopping at thirty needs only <c>i</c>, <c>v</c> and <c>x</c>, and the one
    /// English word in that table is "I" — where folding "Part I" to "part 1" is the point rather
    /// than the accident.
    /// </remarks>
    private const int HighestFoldedNumeral = 30;

    /// <summary>
    /// Dropped from the front of a title, because services disagree about whether to keep one and
    /// about whether they sort under it.
    /// </summary>
    private static readonly string[] Articles = ["the", "a", "an"];

    /// <summary>
    /// Trailing phrases <see cref="WithoutEdition"/> removes, longest first, as runs of tokens
    /// rather than as substrings — "A Hat in Time" must not lose anything to a phrase that happens
    /// to read the same in the middle of a word.
    /// </summary>
    /// <remarks>
    /// This list is allowed to be generous, including entries like <c>remake</c> and <c>redux</c>
    /// that name a genuinely different release, <b>because nothing it produces can be matched
    /// automatically.</b> Its only power is to put "Final Fantasy VII" in front of somebody who
    /// imported "Final Fantasy VII Remake" and let them decide. Moving any of it into
    /// <see cref="Normalise"/> would turn that offer into a silent answer.
    /// </remarks>
    private static readonly string[][] EditionSuffixes =
    [
        ["game", "of", "the", "year", "edition"],
        ["game", "of", "the", "year"],
        ["goty", "edition"],
        ["anniversary", "edition"],
        ["collectors", "edition"],
        ["complete", "edition"],
        ["definitive", "edition"],
        ["deluxe", "edition"],
        ["enhanced", "edition"],
        ["extended", "edition"],
        ["gold", "edition"],
        ["legendary", "edition"],
        ["limited", "edition"],
        ["special", "edition"],
        ["standard", "edition"],
        ["ultimate", "edition"],
        ["directors", "cut"],
        ["remastered"],
        ["remaster"],
        ["remake"],
        ["redux"],
        ["goty"],
        ["edition"],
        ["hd"],
    ];

    /// <summary>The canonical roman numerals up to <see cref="HighestFoldedNumeral"/>, lowercased.</summary>
    private static readonly FrozenDictionary<string, int> Numerals =
        Enumerable.Range(1, HighestFoldedNumeral)
            .ToFrozenDictionary(Roman, value => value, StringComparer.Ordinal);

    /// <summary>
    /// The title as IGDB should be asked about it: the user's own spelling, with only the noise no
    /// search index carries removed.
    /// </summary>
    /// <remarks>
    /// Deliberately <em>not</em> <see cref="Normalise"/>'s output. IGDB matches a search against its
    /// own index of its own titles, so the term with the best recall is the one closest to ordinary
    /// text — stripping articles and rewriting numerals here would be guessing at how somebody
    /// else's search engine tokenises, and guessing wrong costs a candidate that never appears at
    /// all. What is removed is only what cannot help: trademark symbols, control characters and
    /// runs of whitespace.
    /// </remarks>
    public static string Tidy(string title)
    {
        var mapped = new StringBuilder(title.Length);

        foreach (var character in title)
            if (!IsNoise(character))
                mapped.Append(Ascii(character));

        // Whitespace survives the mapping above and is collapsed here, which says "one space
        // between words" outright rather than through a flag carried across a loop.
        var collapsed = string.Join(
            ' ', mapped.ToString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

        return collapsed.Length <= MaxSearchLength ? collapsed : collapsed[..MaxSearchLength];
    }

    /// <summary>Both keys and the numbers, from one pass over the title.</summary>
    public static TitleKeys Keys(string title)
    {
        var tokens = Tokens(title);

        var key = string.Join(' ', tokens);
        var numbers = NumbersIn(tokens);

        StripEditions(tokens);

        return new TitleKeys(key, string.Join(' ', tokens), numbers);
    }

    /// <summary>
    /// The key two titles are compared on, and the only one an automatic match may be decided by.
    /// </summary>
    /// <remarks>
    /// Case, accents, punctuation, ampersands, leading articles and roman numerals are all
    /// differences between two spellings of one name, so each of them goes. An edition suffix is
    /// not — it is frequently the difference between two rows IGDB lists separately — so it
    /// survives here and is removed only by <see cref="WithoutEdition"/>.
    /// </remarks>
    public static string Normalise(string title) => string.Join(' ', Tokens(title));

    /// <summary>
    /// <see cref="Normalise"/>, and then any trailing edition, remaster or cut.
    /// </summary>
    /// <remarks>
    /// Used to find candidates worth offering, never to choose one. It never reduces a title to
    /// nothing: a game actually called "Remastered" keeps its name.
    /// </remarks>
    public static string WithoutEdition(string title)
    {
        var tokens = Tokens(title);
        StripEditions(tokens);
        return string.Join(' ', tokens);
    }

    private static IReadOnlySet<int> NumbersIn(List<string> tokens)
    {
        var numbers = new HashSet<int>();

        foreach (var token in tokens)
            if (int.TryParse(token, NumberStyles.None, CultureInfo.InvariantCulture, out var number))
                numbers.Add(number);

        return numbers;
    }

    /// <summary>
    /// The shared pipeline: tidy, strip accents, casefold, split on anything that is neither a
    /// letter nor a digit, drop a leading article, fold numerals.
    /// </summary>
    private static List<string> Tokens(string title)
    {
        var decomposed = Tidy(title).Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);

        foreach (var character in decomposed)
        {
            // The accent half of a decomposed letter. Dropping it is what makes "Okami" one title
            // however it was typed, and "Pokemon" one whichever service wrote it.
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
                continue;

            // An apostrophe closes up rather than splitting, so "Assassin's Creed" is two tokens
            // and not three. Every other separator becomes a space.
            if (character is '\'') continue;

            if (character is '&')
            {
                builder.Append(" and ");
                continue;
            }

            builder.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : ' ');
        }

        var tokens = builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

        if (tokens.Count > 1 && Articles.Contains(tokens[0], StringComparer.Ordinal))
            tokens.RemoveAt(0);

        for (var i = 0; i < tokens.Count; i++)
            if (Numerals.TryGetValue(tokens[i], out var value))
                tokens[i] = value.ToString(CultureInfo.InvariantCulture);

        return tokens;
    }

    /// <summary>Removes trailing edition phrases until none is left, and never removes them all.</summary>
    private static void StripEditions(List<string> tokens)
    {
        for (var stripped = true; stripped;)
        {
            stripped = false;

            foreach (var suffix in EditionSuffixes)
            {
                // Strictly shorter than the title, so a suffix can never be the whole of it.
                if (tokens.Count <= suffix.Length || !EndsWith(tokens, suffix)) continue;

                tokens.RemoveRange(tokens.Count - suffix.Length, suffix.Length);
                stripped = true;
                break;
            }
        }
    }

    private static bool EndsWith(List<string> tokens, string[] suffix)
    {
        for (var i = 0; i < suffix.Length; i++)
            if (!string.Equals(tokens[tokens.Count - suffix.Length + i], suffix[i], StringComparison.Ordinal))
                return false;

        return true;
    }

    /// <summary>Characters that are decoration rather than part of a name.</summary>
    private static bool IsNoise(char character) =>
        character is '™' or '®' or '©' or '℠' || char.IsControl(character);

    /// <summary>
    /// The ASCII equivalent of a typographic character, so a file written with curly quotes and one
    /// written with straight ones produce the same tokens.
    /// </summary>
    private static char Ascii(char character) => character switch
    {
        '‘' or '’' or '‛' or 'ʼ' => '\'',
        '“' or '”' or '„' => '"',
        '‐' or '‑' or '‒' or '–' or '—' or '―' or '−' => '-',
        _ => character
    };

    /// <summary>
    /// One value as a canonical roman numeral. Only ever called for 1 to
    /// <see cref="HighestFoldedNumeral"/>, which is why the table stops at ten.
    /// </summary>
    private static string Roman(int value)
    {
        (int Value, string Symbol)[] symbols = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")];
        var builder = new StringBuilder();

        foreach (var (number, symbol) in symbols)
            while (value >= number)
            {
                builder.Append(symbol);
                value -= number;
            }

        return builder.ToString();
    }
}
