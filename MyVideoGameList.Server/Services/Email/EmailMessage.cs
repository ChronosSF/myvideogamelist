namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// One email to one person, composed and ready to send.
/// </summary>
/// <param name="Purpose">
/// What the email is, in a few words, for the log: <c>account confirmation</c>. It is the only part
/// of a message a log line ever names.
/// </param>
/// <param name="To">The recipient's address. Never written to a log.</param>
/// <param name="Subject">The subject line.</param>
/// <param name="Text">The plain-text body. Every message has one.</param>
/// <param name="Html">An HTML body to go beside the text, or null for text only.</param>
public sealed record EmailMessage(string Purpose, string To, string Subject, string Text, string? Html = null)
{
    /// <summary>
    /// The purpose and nothing else. A record's own <c>ToString</c> would print every member, the
    /// address and a link's token among them, into whatever log line a message is ever interpolated
    /// into by mistake.
    /// </summary>
    public override string ToString() => $"{Purpose} email";
}
