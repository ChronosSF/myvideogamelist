using System.Collections.Concurrent;
using System.Net;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Cloudflare's Turnstile, as far as the test host has one (ADR 0092): <see cref="Bot"/> is refused and
/// any other token passes, so a test chooses its verdict by the token it sends.
/// </summary>
/// <remarks>
/// The application's own asks Cloudflare over the network, which a test run must not depend on. What is
/// replaced is only the question; the controller's handling of each answer is the application's own.
/// </remarks>
public sealed class JudgingTurnstile : ITurnstile
{
    /// <summary>What a person's browser hands over: any token but <see cref="Bot"/>.</summary>
    public const string Person = "integration-person";

    /// <summary>The one token Cloudflare will not vouch for.</summary>
    public const string Bot = "integration-bot";

    private readonly ConcurrentQueue<string> asked = new();

    /// <summary>Every token the API asked about, in order.</summary>
    public IReadOnlyList<string> Asked => asked.ToArray();

    public string? SiteKey => "integration-site-key";

    public Task<TurnstileVerdict> VerifyAsync(string token, IPAddress? remoteIp, CancellationToken cancellationToken)
    {
        asked.Enqueue(token);
        return Task.FromResult(token == Bot ? TurnstileVerdict.Refused : TurnstileVerdict.Passed);
    }
}
