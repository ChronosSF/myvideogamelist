using System.Globalization;
using System.Text;

namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Writes each message to a folder as an <c>.eml</c> file, and sends nothing.
/// </summary>
/// <remarks>
/// <para>
/// Development's sender, so that signing up on a developer machine needs no AWS: the log line says
/// which file to open, and any mail program opens it, or any editor, since the text body is written
/// as it is. The browser smoke test reads its links from these files (ADR 0060's harness, ADR 0088).
/// </para>
/// <para>
/// The file name is a time and a random suffix, never the recipient, so the log line that names it
/// names nobody. Files are never removed: the folder is the developer's.
/// </para>
/// </remarks>
internal sealed class OutboxEmailTransport(
    string directory,
    EmailSender sender,
    TimeProvider clock,
    ILogger<OutboxEmailTransport> logger) : IEmailTransport
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        Directory.CreateDirectory(directory);

        var path = Path.Combine(directory,
            $"{now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture)}-{Guid.NewGuid():N}.eml");
        await File.WriteAllTextAsync(path, Eml.Format(message, sender, now), Eml.Encoding, cancellationToken);

        logger.LogInformation("Wrote the {Purpose} email to {Path}. Nothing was sent.", message.Purpose, path);
    }
}

/// <summary>
/// A message as an <c>.eml</c> file: enough of RFC 5322 and MIME for a mail program to open it.
/// </summary>
internal static class Eml
{
    /// <summary>UTF-8 without a byte-order mark, which would come before the first header.</summary>
    internal static readonly Encoding Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    private const string Boundary = "mvgl-alternative";

    internal static string Format(EmailMessage message, EmailSender sender, DateTimeOffset date)
    {
        var eml = new StringBuilder();
        Header(eml, "From", sender.From.ToString());
        Header(eml, "Reply-To", sender.ReplyTo.Address);
        Header(eml, "To", message.To);
        Header(eml, "Subject", EncodedWord(message.Subject));
        Header(eml, "Date", date.ToString("r", CultureInfo.InvariantCulture));
        Header(eml, "MIME-Version", "1.0");

        if (message.Html is null)
        {
            Part(eml, "text/plain", message.Text);
            return eml.ToString();
        }

        Header(eml, "Content-Type", $"multipart/alternative; boundary=\"{Boundary}\"");
        eml.Append("\r\n");
        eml.Append($"--{Boundary}\r\n");
        Part(eml, "text/plain", message.Text);
        eml.Append($"\r\n--{Boundary}\r\n");
        Part(eml, "text/html", message.Html);
        eml.Append($"\r\n--{Boundary}--\r\n");
        return eml.ToString();
    }

    private static void Part(StringBuilder eml, string type, string body)
    {
        Header(eml, "Content-Type", $"{type}; charset=utf-8");
        Header(eml, "Content-Transfer-Encoding", "8bit");
        eml.Append("\r\n");
        eml.Append(body.ReplaceLineEndings("\r\n"));
    }

    private static void Header(StringBuilder eml, string name, string value) =>
        eml.Append(name).Append(": ").Append(value.ReplaceLineEndings(" ")).Append("\r\n");

    /// <summary>A subject as RFC 2047 asks for anything outside ASCII, and as it is otherwise.</summary>
    private static string EncodedWord(string text) =>
        text.All(char.IsAscii) ? text : $"=?utf-8?B?{Convert.ToBase64String(Encoding.GetBytes(text))}?=";
}
