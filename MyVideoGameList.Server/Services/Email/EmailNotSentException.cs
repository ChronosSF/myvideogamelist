namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// An email that was not delivered to the sending service: refused, throttled, or never answered.
/// </summary>
/// <remarks>
/// <para>
/// It carries no inner exception, on purpose. SES's refusal text names the recipient
/// ("the following identities failed the check: someone@example.com"), and the exception handler
/// logs an exception with everything inside it. <see cref="Reason"/> is that text with every address
/// masked, which keeps what an operator needs (the error code, the identity, the Region) and loses
/// the one thing a log line here may never hold.
/// </para>
/// <para>
/// The reason is a property and not part of the message, because the transport has already logged
/// it. A caller that lets this escape is logged by the exception handler as well, and that line
/// says which email failed without repeating why.
/// </para>
/// </remarks>
public sealed class EmailNotSentException(string purpose, string reason)
    : Exception($"The {purpose} email was not sent; the transport logged why.")
{
    /// <summary>What the email was, as <see cref="EmailMessage.Purpose"/> said.</summary>
    public string Purpose { get; } = purpose;

    /// <summary>Why it was not sent, with every address masked.</summary>
    public string Reason { get; } = reason;
}
