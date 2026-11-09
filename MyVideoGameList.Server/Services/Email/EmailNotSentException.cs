namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// An email that was not delivered to the sending service: refused, throttled, or never answered.
/// </summary>
/// <remarks>
/// It carries no inner exception, on purpose. SES's refusal text names the recipient
/// ("the following identities failed the check: someone@example.com"), and the exception handler
/// logs an exception with everything inside it. <see cref="Reason"/> is that text with every address
/// masked, which keeps what an operator needs (the error code, the identity, the Region) and loses
/// the one thing a log line here may never hold.
/// </remarks>
public sealed class EmailNotSentException(string purpose, string reason)
    : Exception($"The {purpose} email was not sent: {reason}")
{
    /// <summary>What the email was, as <see cref="EmailMessage.Purpose"/> said.</summary>
    public string Purpose { get; } = purpose;

    /// <summary>Why it was not sent, with every address masked.</summary>
    public string Reason { get; } = reason;
}
