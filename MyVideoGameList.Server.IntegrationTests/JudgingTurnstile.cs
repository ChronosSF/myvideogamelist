using System.Collections.Concurrent;
using System.Net;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Cloudflare's Turnstile, as far as the test host has one (ADR 0092): <see cref="Bot"/> is refused,
/// <see cref="Unreachable"/> and <see cref="NoKeys"/> are the two ways it cannot be asked at all, and any
/// other token passes, so a test chooses its verdict by the token it sends.
/// </summary>
/// <remarks>
/// The application's own asks Cloudflare over the network, which a test run must not depend on. What is
/// replaced is only the question; the controller's handling of each answer is the application's own.
/// </remarks>
public sealed class JudgingTurnstile : ITurnstile
{
    /// <summary>What a person's browser hands over: any token but the three below.</summary>
    public const string Person = "integration-person";

    /// <summary>The one token Cloudflare will not vouch for.</summary>
    public const string Bot = "integration-bot";

    /// <summary>The token Cloudflare does not answer about, failing as the application's own does then.</summary>
    public const string Unreachable = "integration-unreachable";

    /// <summary>The token a deployment with no keys is asked about: it can check nobody.</summary>
    public const string NoKeys = "integration-no-keys";

    private readonly ConcurrentQueue<string> asked = new();

    /// <summary>Every token the API asked about, in order.</summary>
    public IReadOnlyList<string> Asked => asked.ToArray();

    public string? SiteKey => "integration-site-key";

    public Task<TurnstileVerdict> VerifyAsync(string token, IPAddress? remoteIp, CancellationToken cancellationToken)
    {
        asked.Enqueue(token);
        return token switch
        {
            Bot => Task.FromResult(TurnstileVerdict.Refused),
            NoKeys => Task.FromResult(TurnstileVerdict.NotConfigured),
            Unreachable => Task.FromException<TurnstileVerdict>(Turnstile.DidNotAnswer()),
            _ => Task.FromResult(TurnstileVerdict.Passed),
        };
    }
}
