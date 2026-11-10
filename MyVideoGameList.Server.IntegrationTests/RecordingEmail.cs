using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
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
/// <see cref="Browsers.RegisterAsync"/> is called on a browser, which knows no factory, so each
/// browser <see cref="ApiFactory.CreateBrowser"/> makes is tied to its own factory's recording here,
/// and a sign-up reads its link from the host it signed up on and from nothing else.
/// </para>
/// </remarks>
public sealed class RecordingEmail : IEmailTransport
{
    private static readonly ConditionalWeakTable<HttpClient, RecordingEmail> browsers = new();

    private readonly ConcurrentQueue<EmailMessage> sent = new();

    /// <summary>Ties a browser to the recording of the host it talks to.</summary>
    internal void Serves(HttpClient browser) => browsers.AddOrUpdate(browser, this);

    /// <summary>The recording of the host <paramref name="browser"/> talks to.</summary>
    internal static RecordingEmail Of(HttpClient browser) =>
        browsers.TryGetValue(browser, out var recording)
            ? recording
            : throw new InvalidOperationException("This browser was not made by ApiFactory.CreateBrowser.");

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
        return Task.CompletedTask;
    }

    /// <summary>The account and token in the latest confirmation link this host sent to <paramref name="address"/>.</summary>
    public ConfirmEmailLink LatestConfirmationTo(string address)
    {
        var message = sent.LastOrDefault(message =>
                string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase)
                && message.Purpose == "account confirmation")
            ?? throw new InvalidOperationException($"No confirmation was sent to {address}.");
        return ConfirmEmailLink.In(message.Text);
    }

    /// <summary>The account and token in the latest reset link this host sent to <paramref name="address"/>.</summary>
    public ResetPasswordLink LatestResetTo(string address)
    {
        var message = sent.LastOrDefault(message =>
                string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase)
                && message.Purpose == "password reset")
            ?? throw new InvalidOperationException($"No password reset was sent to {address}.");
        return ResetPasswordLink.In(message.Text);
    }
}

/// <summary>The two halves of a confirmation link, read from an email as a reader's page reads them.</summary>
public sealed record ConfirmEmailLink(string Url, string UserId, string Token)
{
    public static ConfirmEmailLink In(string text)
    {
        var (url, parts) = AccountLink.In(text, "/confirm-email#");
        return new ConfirmEmailLink(url, parts["user"], parts["token"]);
    }
}

/// <summary>The two halves of a reset link, read from an email as a reader's page reads them.</summary>
public sealed record ResetPasswordLink(string Url, string UserId, string Token)
{
    public static ResetPasswordLink In(string text)
    {
        var (url, parts) = AccountLink.In(text, "/reset-password#");
        return new ResetPasswordLink(url, parts["user"], parts["token"]);
    }
}

/// <summary>The one link in an email's text that leads to <c>page</c>, and the decoded pairs after its <c>#</c>.</summary>
internal static class AccountLink
{
    public static (string Url, Dictionary<string, string> Parts) In(string text, string page)
    {
        var url = text.Split((char[])['\n', '\r', ' '], StringSplitOptions.RemoveEmptyEntries)
            .Single(word => word.Contains(page, StringComparison.Ordinal));
        var fragment = url[(url.IndexOf('#') + 1)..];
        var parts = fragment.Split('&')
            .Select(pair => pair.Split('=', 2))
            .ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]));
        return (url, parts);
    }
}
