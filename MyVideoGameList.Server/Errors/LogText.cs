using System.Globalization;

namespace MyVideoGameList.Server.Errors;

/// <summary>
/// Text from a request, made fit to sit in a log line.
/// </summary>
/// <remarks>
/// <para>
/// A request path reaches the app <em>decoded</em>, so <c>/api/%0AINFO%3A+all+clear</c> arrives as
/// a value with a real newline in it. Written straight to a log, that is a second line somebody
/// reading the log — or something parsing it — has no way to tell from one the app wrote. CodeQL
/// flagged exactly this on the pull request that introduced the logging.
/// </para>
/// <para>
/// Dropping the path instead would be the other fix, and it costs the thing the log line is for:
/// knowing which request failed.
/// </para>
/// </remarks>
internal static class LogText
{
    /// <summary>
    /// Long enough for any real path plus its query, short enough that a crafted one cannot bury
    /// the lines around it.
    /// </summary>
    private const int MaxLength = 200;

    public static string OneLine(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;

        // The line breaks first and by name, because they are the ones that forge an entry. The
        // filter then takes the rest - tabs, and the Unicode separators that char.IsControl does
        // not count as control characters though a log reader may still break on them.
        var flattened = value.Replace("\r", string.Empty).Replace("\n", string.Empty);
        var printable = string.Concat(flattened.Where(character => !BreaksALine(character)));

        return printable.Length <= MaxLength ? printable : printable[..MaxLength] + "...";
    }

    private static bool BreaksALine(char character) =>
        char.IsControl(character)
        || char.GetUnicodeCategory(character)
            is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator;
}
