using System.Net;
using System.Text.Json.Serialization;

namespace MyVideoGameList.Server.Security;

/// <summary>What Cloudflare said of a sign-up's Turnstile token.</summary>
public enum TurnstileVerdict
{
    /// <summary>A person, as far as Cloudflare can tell.</summary>
    Passed,

    /// <summary>Not a token Cloudflare will vouch for: made up, spent already, expired, or a bot's.</summary>
    Refused,

    /// <summary>This deployment has no keys, so it vouches for nobody and takes no sign-ups.</summary>
    NotConfigured,
}

/// <summary>
/// The check that a sign-up comes from a person (ADR 0092): the site key the page's widget draws with,
/// and the question to Cloudflare about the token the widget handed back.
/// </summary>
public interface ITurnstile
{
    /// <summary>The site key the page's widget needs, or null where this deployment has none.</summary>
    string? SiteKey { get; }

    /// <summary>
    /// Asks Cloudflare whether <paramref name="token"/> is one it gave a person. A token is good once:
    /// asking spends it, whatever the answer.
    /// </summary>
    /// <exception cref="HttpRequestException">
    /// Cloudflare did not answer, which <c>UpstreamFailureHandler</c> makes a 502: sign-up waits for it
    /// rather than letting an unchecked account through.
    /// </exception>
    Task<TurnstileVerdict> VerifyAsync(string token, IPAddress? remoteIp, CancellationToken cancellationToken);
}

/// <summary>The pair of keys one Turnstile widget has: one the page shows, one only this server holds.</summary>
public sealed record TurnstileKeys(string SiteKey, string SecretKey)
{
    /// <summary>
    /// Cloudflare's published test keys that always pass: what Development uses when it names none, so a
    /// fresh checkout signs up with no setup. They pass whoever asks, which is why nothing deployed may use
    /// them (<see cref="TurnstileRegistration"/>).
    /// </summary>
    public static readonly TurnstileKeys AlwaysPasses = new("1x00000000000000000000AA", "1x0000000000000000000000000000000AA");

    /// <summary>
    /// Whether a secret is one of Cloudflare's three test secrets, which pass, fail or call every token
    /// spent, whoever asks. Seen live: siteverify answers each with <c>result_with_testing_key</c>.
    /// </summary>
    public static bool IsTestSecret(string secret) =>
        secret is "1x0000000000000000000000000000000AA"
            or "2x0000000000000000000000000000000AA"
            or "3x0000000000000000000000000000000AA";
}

/// <summary>
/// Asks Cloudflare's siteverify about a token, with this deployment's secret.
/// </summary>
/// <remarks>
/// <para>
/// <b>No retry.</b> Asking spends the token, so a second attempt after a first that Cloudflare answered
/// but we never read would be told the token is spent, and refuse a person. The page draws a new token
/// and the person presses the button again, which is the retry.
/// </para>
/// <para>
/// <b>A refusal is logged without the token</b>, by Cloudflare's error codes alone, and a refusal for our
/// own secret is an error, because then every sign-up is refused and nothing else says why.
/// </para>
/// </remarks>
public sealed class Turnstile(
    IHttpClientFactory clients,
    TurnstileKeys? keys,
    Uri siteVerify,
    ILogger<Turnstile> logger) : ITurnstile
{
    /// <summary>The name of the <see cref="HttpClient"/> this asks through, with its own short timeout.</summary>
    public const string ClientName = "Turnstile";

    /// <summary>Cloudflare's siteverify, which every deployment asks.</summary>
    public static readonly Uri CloudflareSiteVerify = new("https://challenges.cloudflare.com/turnstile/v0/siteverify");

    public string? SiteKey => keys?.SiteKey;

    public async Task<TurnstileVerdict> VerifyAsync(string token, IPAddress? remoteIp, CancellationToken cancellationToken)
    {
        if (keys is null)
        {
            logger.LogError("A sign-up was refused because this deployment has no Turnstile keys. Set Turnstile:SiteKey and Turnstile:SecretKey (ADR 0092).");
            return TurnstileVerdict.NotConfigured;
        }

        var form = new Dictionary<string, string> { ["secret"] = keys.SecretKey, ["response"] = token };
        // The address the browser came from, which Cloudflare weighs. It has it already: the browser
        // fetched the widget from Cloudflare directly.
        if (remoteIp is not null) form["remoteip"] = remoteIp.ToString();

        using var response = await clients.CreateClient(ClientName)
            .PostAsync(siteVerify, new FormUrlEncodedContent(form), cancellationToken);
        response.EnsureSuccessStatusCode();

        var answer = await response.Content.ReadFromJsonAsync<SiteVerifyAnswer>(cancellationToken)
            ?? throw new HttpRequestException("Cloudflare's siteverify answered with nothing.");

        if (answer.Success) return TurnstileVerdict.Passed;

        var codes = answer.ErrorCodes ?? [];
        if (codes.Any(code => code is "missing-input-secret" or "invalid-input-secret"))
        {
            logger.LogError("Cloudflare refused this deployment's Turnstile secret, so every sign-up is refused until it is set (ADR 0092). Error codes: {Codes}", string.Join(", ", codes));
        }
        else
        {
            logger.LogInformation("A sign-up's Turnstile token was refused. Error codes: {Codes}", string.Join(", ", codes));
        }

        return TurnstileVerdict.Refused;
    }

    /// <summary>The part of siteverify's answer this reads.</summary>
    private sealed record SiteVerifyAnswer(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("error-codes")] string[]? ErrorCodes);
}

public static class TurnstileRegistration
{
    public const string SectionName = "Turnstile";

    /// <summary>
    /// Registers <see cref="ITurnstile"/> with the keys <c>Turnstile:SiteKey</c> and
    /// <c>Turnstile:SecretKey</c> name: Cloudflare's always-passing test keys in Development when it names
    /// none, and otherwise none, which refuses every sign-up.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>No keys is not a startup failure</b>, unlike no email sender (ADR 0088). The host that boots
    /// without them is mostly not the API: the migration task and the bundle's build boot the same host,
    /// and would each have to be handed a secret they never use. A deployment with none still serves
    /// everything but sign-up, which it refuses, with an error in the log on every attempt.
    /// </para>
    /// <para>
    /// <b>A test secret outside Development is.</b> Cloudflare's test secrets pass, fail or spend every
    /// token whoever asks, so one in a deployment would take any sign-up a bot sent, with a clean log.
    /// </para>
    /// <para>
    /// <c>Turnstile:SiteVerifyUrl</c> is for the browser smoke test's stand-in, which answers as
    /// Cloudflare does so that a run reaches no third party, as its stand-in for IGDB does (ADR 0060).
    /// Nothing deployed sets it, and Development may only point it at this machine.
    /// </para>
    /// </remarks>
    public static IServiceCollection AddTurnstile(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(SectionName);
        var siteKey = Value(section, "SiteKey");
        var secretKey = Value(section, "SecretKey");

        if ((siteKey is null) != (secretKey is null))
        {
            throw new InvalidOperationException(
                $"{SectionName}:SiteKey and {SectionName}:SecretKey are one widget's pair: set both, or neither.");
        }

        var keys = siteKey is not null && secretKey is not null
            ? new TurnstileKeys(siteKey, secretKey)
            : environment.IsDevelopment() ? TurnstileKeys.AlwaysPasses : null;

        if (keys is not null && TurnstileKeys.IsTestSecret(keys.SecretKey) && !environment.IsDevelopment())
        {
            throw new InvalidOperationException(
                $"{SectionName}:SecretKey is one of Cloudflare's test secrets, which answer the same whoever "
                + "asks. Outside Development that is a sign-up with no check at all. See ADR 0092.");
        }

        var siteVerify = Turnstile.CloudflareSiteVerify;
        if (Value(section, "SiteVerifyUrl") is { } configured)
        {
            // A stand-in on this machine, for the smoke test, and nothing else: anywhere else it would be
            // a way to make every token pass.
            siteVerify = environment.IsDevelopment()
                && Uri.TryCreate(configured, UriKind.Absolute, out var local) && local.IsLoopback
                    ? local
                    : throw new InvalidOperationException(
                        $"{SectionName}:SiteVerifyUrl is for a stand-in on this machine, in Development only. See ADR 0092.");
        }

        // Cloudflare answers in well under a second. The default hundred seconds would hold a sign-up
        // open for as long as an outage lasted.
        services.AddHttpClient(Turnstile.ClientName, client => client.Timeout = TimeSpan.FromSeconds(8));
        services.AddSingleton<ITurnstile>(provider => new Turnstile(
            provider.GetRequiredService<IHttpClientFactory>(),
            keys,
            siteVerify,
            provider.GetRequiredService<ILogger<Turnstile>>()));
        return services;
    }

    private static string? Value(IConfigurationSection section, string key) =>
        section[key]?.Trim() is { Length: > 0 } value ? value : null;
}
