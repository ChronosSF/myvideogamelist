namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Raised when an uploaded file is not the thing it claims to be, or is a version of it we do not
/// know how to read. Answered to the user as a 400 with the message, so the message is written to
/// be read by one.
/// </summary>
internal sealed class ImportParseException(string message) : Exception(message);

/// <summary>
/// One service's export, turned into canonical rows.
/// </summary>
/// <remarks>
/// <para>
/// This is the seam, and it is one level up from where `specs/csv-list-import.md` §3 put it. That
/// document proposed a column map plus a status vocabulary, which is a fine description of a flat
/// CSV and cannot describe Grouvee at all: its export is a nested document whose <c>shelves</c> is
/// an object keyed by shelf name and whose <c>dates</c> is an array of runs. A column map has no
/// way to say either.
/// </para>
/// <para>
/// So a source takes a <em>file</em> and produces rows, and "a flat CSV plus a user-supplied column
/// map" becomes one implementation of this interface rather than the shape of all of them — the one
/// every service without a structured export will use. Everything after this point, which is where
/// the work actually is, is shared: the review, the conflict check, the commit and the failure
/// report neither know nor care which source produced a row. See ADR 0037, decision 1.
/// </para>
/// </remarks>
internal interface IImportSource
{
    /// <summary>One of <c>ImportSources</c>. Written to <c>UserGameEntry.Origin</c> on every row this import creates.</summary>
    string Key { get; }

    /// <summary>
    /// Whether this source recognises the file, cheaply, from its name and its first bytes.
    /// </summary>
    /// <remarks>
    /// The preset-detection fingerprint of §3. It must not throw and must not consume the stream
    /// past what it reads, because several sources are offered the same file in turn.
    /// </remarks>
    bool CanRead(string fileName, ReadOnlySpan<char> head);

    /// <summary>
    /// The rows in the file, in the order they appear.
    /// </summary>
    /// <exception cref="ImportParseException">
    /// The file is not this source's export, or is a major version of it this code does not know.
    /// Refusing loudly is the point: a renamed field read as null would import a library with its
    /// scores and dates quietly missing, which is the silent-empty failure class that has caught
    /// this project before.
    /// </exception>
    IReadOnlyList<ImportRowPayload> Read(string content);
}
