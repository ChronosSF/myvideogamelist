namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// What the import does to text it reads from a file, before the text means anything: every source's
/// blank field, and every column's length.
/// </summary>
internal static class ImportText
{
    /// <summary>
    /// The value trimmed, or null when nothing but whitespace was there: a blank field in an export is
    /// a field its owner left empty, in every source.
    /// </summary>
    public static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// At most <paramref name="length"/> UTF-16 units of the value, never ending on the first half of a
    /// surrogate pair.
    /// </summary>
    /// <remarks>
    /// A column's length counts the units, which is why the cut is made in them, but a cut between the
    /// two halves of one character — an emoji, most often — leaves half a character that UTF-8 cannot
    /// carry. Ending one unit early drops the whole character instead.
    /// </remarks>
    public static string Truncate(string value, int length)
    {
        if (value.Length <= length) return value;

        var cut = char.IsHighSurrogate(value[length - 1]) ? length - 1 : length;
        return value[..cut];
    }

    /// <summary>
    /// The value cut as <see cref="Truncate"/> cuts it, and ending in an ellipsis when it was cut, so
    /// that whoever reads it later can see that something is missing from the end.
    /// </summary>
    /// <remarks>
    /// For prose — a note, a review that became one — where text that stops mid-sentence with no mark
    /// reads as though its owner stopped there. The ellipsis is one unit, so the result still fits.
    /// </remarks>
    public static string TruncateMarked(string value, int length) =>
        value.Length <= length ? value : Truncate(value, length - 1) + "…";
}
