using System.Net.Mail;
using System.Text.RegularExpressions;
using MyVideoGameList.Server.Errors;

namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Who every email is from, and where a reply goes.
/// </summary>
/// <param name="From">
/// The sender, display name included: <c>MyVideoGameList &lt;noreply@myvideogamelist.net&gt;</c>. The
/// address is the one the production account's sending role is limited to (ADR 0088), so it changes
/// only together with that role.
/// </param>
/// <param name="ReplyTo">Where a reply goes: a mailbox somebody reads.</param>
public sealed record EmailSender(MailAddress From, MailAddress ReplyTo)
{
    /// <summary>
    /// <see cref="From"/> as a <c>From</c> header takes it: a display name outside ASCII as an RFC 2047
    /// encoded word, which SES requires and <see cref="MailAddress.ToString"/> does not write.
    /// </summary>
    public string FromHeader => From.DisplayName.All(char.IsAscii)
        ? From.ToString()
        : $"=?utf-8?B?{Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(From.DisplayName))}?= <{From.Address}>";
}

/// <summary>
/// Text about an email, made fit for a log line.
/// </summary>
internal static partial class EmailLogText
{
    /// <summary>What an address becomes.</summary>
    internal const string Masked = "<address>";

    /// <summary>
    /// <paramref name="text"/> with anything shaped like an address masked, on one line.
    /// </summary>
    /// <remarks>
    /// Deliberately broad: anything with an <c>@</c> between two runs of characters that cannot end
    /// an address. A false positive costs a word of an error message; a false negative puts
    /// somebody's address in the log.
    /// </remarks>
    /// <remarks>
    /// Kept to a thousand characters rather than <see cref="LogText"/>'s usual two hundred: an
    /// <c>AccessDenied</c> names the role and the resource it was refused on at its end, and that end is
    /// the part an operator needs.
    /// </remarks>
    internal static string Mask(string? text) =>
        LogText.OneLine(text is null ? null : Address().Replace(text, Masked), maxLength: 1000);

    [GeneratedRegex("""[^\s<>()\[\]"',;:]+@[^\s<>()\[\]"',;:]+""")]
    private static partial Regex Address();
}
