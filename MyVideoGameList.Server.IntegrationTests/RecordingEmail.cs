using System.Collections.Concurrent;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The sending service, as far as the test host has one: every email the API composed, in order.
/// </summary>
/// <remarks>
/// <para>
/// The application's own transport outside Development is the outbox, which writes files nothing here
/// would read back. This keeps the messages instead, and can be told to refuse the next one, as SES
/// would refuse it.
/// </para>
/// <para>
/// Every recording also goes into one list shared by the whole run, keyed by nothing but the address,
/// because <see cref="Browsers.RegisterAsync"/> is called on a browser, which knows no factory. Each
/// test's addresses are its own, so a recipient's latest email is that test's.
/// </para>
/// </remarks>
public sealed class RecordingEmail : IEmailTransport
{
    private static readonly ConcurrentQueue<EmailMessage> everything = new();

    private readonly ConcurrentQueue<EmailMessage> sent = new();

    private int refuseNext;

    public IReadOnlyList<EmailMessage> Sent => sent.ToArray();

    public IReadOnlyList<EmailMessage> SentTo(string address) =>
        [.. sent.Where(message => string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase))];

    /// <summary>The next send fails as SES's refusal would, and nothing is recorded.</summary>
    public void RefuseNext() => Interlocked.Exchange(ref refuseNext, 1);

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        if (Interlocked.Exchange(ref refuseNext, 0) == 1)
            throw new EmailNotSentException(message.Purpose, "MessageRejected (400): refused by the test");

        sent.Enqueue(message);
        everything.Enqueue(message);
        return Task.CompletedTask;
    }

    /// <summary>
    /// The account and token in the latest confirmation link sent to <paramref name="address"/>, by any
    /// test host in this run.
    /// </summary>
    public static ConfirmEmailLink LatestConfirmationTo(string address)
    {
        var message = everything.LastOrDefault(message =>
                string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase)
                && message.Purpose == "account confirmation")
            ?? throw new InvalidOperationException($"No confirmation was sent to {address}.");
        return ConfirmEmailLink.In(message.Text);
    }
}

/// <summary>The two halves of a confirmation link, read from an email as a reader's page reads them.</summary>
public sealed record ConfirmEmailLink(string Url, string UserId, string Token)
{
    public static ConfirmEmailLink In(string text)
    {
        var url = text.Split((char[])['\n', '\r', ' '], StringSplitOptions.RemoveEmptyEntries)
            .Single(word => word.Contains("/confirm-email#", StringComparison.Ordinal));
        var fragment = url[(url.IndexOf('#') + 1)..];
        var parts = fragment.Split('&')
            .Select(pair => pair.Split('=', 2))
            .ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]));
        return new ConfirmEmailLink(url, parts["user"], parts["token"]);
    }
}
