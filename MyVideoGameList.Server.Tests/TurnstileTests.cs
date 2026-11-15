using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Errors;
using MyVideoGameList.Server.Security;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The check that a sign-up comes from a person (ADR 0092): what Cloudflare's answers mean, and which keys
/// a process gets. The answers are the shapes siteverify gave live for Cloudflare's test secrets.
/// </summary>
public class TurnstileTests
{
    private static readonly TurnstileKeys Keys = new("site-key", "secret-key");

    /// <summary>Answers every request with <paramref name="json"/>, and keeps what it was sent.</summary>
    private sealed class SiteVerify(string json, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public Dictionary<string, string>? Form { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = await request.Content!.ReadAsStringAsync(cancellationToken);
            Form = body.Split('&').Select(pair => pair.Split('=')).ToDictionary(
                pair => Uri.UnescapeDataString(pair[0]), pair => Uri.UnescapeDataString(pair[1]));
            return new HttpResponseMessage(status) { Content = new StringContent(json) };
        }
    }

    private static Turnstile Turnstile(HttpMessageHandler handler, TurnstileKeys? keys = null)
    {
        var clients = Substitute.For<IHttpClientFactory>();
        clients.CreateClient(Security.Turnstile.ClientName).Returns(_ => new HttpClient(handler, disposeHandler: false));
        return new Turnstile(clients, keys ?? Keys, Security.Turnstile.CloudflareSiteVerify, NullLogger<Turnstile>.Instance);
    }

    [Fact]
    public async Task VerifyAsync_CloudflareVouches_Passes()
    {
        var siteVerify = new SiteVerify("""{"success":true,"error-codes":[],"hostname":"example.com"}""");

        var verdict = await Turnstile(siteVerify).VerifyAsync("token", IPAddress.Parse("203.0.113.7"), CancellationToken.None);

        Assert.Equal(TurnstileVerdict.Passed, verdict);
        // The secret, the token and the reader's address, as siteverify's form fields.
        Assert.Equal("secret-key", siteVerify.Form!["secret"]);
        Assert.Equal("token", siteVerify.Form["response"]);
        Assert.Equal("203.0.113.7", siteVerify.Form["remoteip"]);
    }

    [Theory]
    [InlineData("invalid-input-response")]
    [InlineData("timeout-or-duplicate")]
    [InlineData("invalid-input-secret")]
    public async Task VerifyAsync_CloudflareDoesNot_Refuses(string code)
    {
        // Our own secret refused is a refusal too: nobody signs up unchecked because the key is wrong.
        var siteVerify = new SiteVerify($$"""{"success":false,"error-codes":["{{code}}"],"messages":[]}""");

        Assert.Equal(TurnstileVerdict.Refused, await Turnstile(siteVerify).VerifyAsync("token", null, CancellationToken.None));
        Assert.False(siteVerify.Form!.ContainsKey("remoteip"));
    }

    [Fact]
    public async Task VerifyAsync_CloudflareFails_IsAnUpstreamFailure()
    {
        // Which UpstreamFailureHandler makes a 502, never a sign-up let through.
        var siteVerify = new SiteVerify("", HttpStatusCode.InternalServerError);

        var failure = await Assert.ThrowsAsync<UpstreamUnavailableException>(
            () => Turnstile(siteVerify).VerifyAsync("token", null, CancellationToken.None));

        // With a sentence of its own: the handler's is about game data.
        Assert.Contains("person", failure.Detail);
        Assert.IsType<HttpRequestException>(failure.InnerException);
    }

    [Theory]
    [InlineData("")]
    [InlineData("<html><body>Bad gateway</body></html>")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("""{"error-codes":[]}""")]
    [InlineData("""{"success":null}""")]
    [InlineData("""{"success":"true"}""")]
    public async Task VerifyAsync_A200ThatIsNotTheAnswer_IsAnUpstreamFailure(string body)
    {
        // A 200 from something in between, or an answer cut short: Cloudflare's failure, never a 500 of ours.
        // JSON that does not say whether the token passed is no answer either, never a refused token, which
        // would tell a person to do a check that cannot pass (Copilot, #468).
        await Assert.ThrowsAsync<UpstreamUnavailableException>(
            () => Turnstile(new SiteVerify(body)).VerifyAsync("token", null, CancellationToken.None));
    }

    /// <summary>Never answers: cancelled by <paramref name="timeout"/>, as a client's own timeout cancels a call.</summary>
    private sealed class Silent(CancellationToken timeout) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            using var either = CancellationTokenSource.CreateLinkedTokenSource(timeout, cancellationToken);
            await Task.Delay(Timeout.Infinite, either.Token);
            throw new InvalidOperationException("Unreachable: the delay only ends by cancellation.");
        }
    }

    [Fact]
    public async Task VerifyAsync_TheCallTimesOut_IsAnUpstreamFailure()
    {
        using var timeout = new CancellationTokenSource();
        var asking = Turnstile(new Silent(timeout.Token)).VerifyAsync("token", null, CancellationToken.None);

        await timeout.CancelAsync();

        await Assert.ThrowsAsync<UpstreamUnavailableException>(() => asking);
    }

    [Fact]
    public async Task VerifyAsync_TheReaderLeaves_IsACancellationNotAnUpstreamFailure()
    {
        // Which ClientDisconnectHandler makes a 499. Cloudflare did nothing wrong.
        using var reader = new CancellationTokenSource();
        var asking = Turnstile(new Silent(CancellationToken.None)).VerifyAsync("token", null, reader.Token);

        await reader.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => asking);
    }

    [Fact]
    public async Task VerifyAsync_NoKeys_AsksNobodyAndRefuses()
    {
        var siteVerify = new SiteVerify("""{"success":true}""");
        var clients = Substitute.For<IHttpClientFactory>();
        var turnstile = new Turnstile(clients, keys: null, Security.Turnstile.CloudflareSiteVerify, NullLogger<Turnstile>.Instance);

        Assert.Null(turnstile.SiteKey);
        Assert.Equal(TurnstileVerdict.NotConfigured, await turnstile.VerifyAsync("token", null, CancellationToken.None));
        clients.DidNotReceiveWithAnyArgs().CreateClient(default!);
    }

    private static IConfiguration Configuration(params (string Key, string Value)[] settings) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();

    private static IHostEnvironment Environment(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    private static ITurnstile Registered(IConfiguration configuration, string environment) =>
        new ServiceCollection()
            .AddLogging()
            .AddTurnstile(configuration, Environment(environment))
            .BuildServiceProvider()
            .GetRequiredService<ITurnstile>();

    [Fact]
    public void AddTurnstile_DevelopmentWithNoKeys_UsesTheTestKeysThatPass()
    {
        // A fresh checkout signs up with no setup.
        Assert.Equal(TurnstileKeys.AlwaysPasses.SiteKey, Registered(Configuration(), Environments.Development).SiteKey);
    }

    [Fact]
    public void AddTurnstile_DeployedWithNoKeys_StartsAndTakesNoSignUps()
    {
        // Starts, because the migration task boots this host too; takes no sign-ups, because none is checked.
        Assert.Null(Registered(Configuration(), Environments.Production).SiteKey);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Development")]
    public void AddTurnstile_TheDataStacksPlaceholder_IsNoKeys(string environment)
    {
        // What the App stack hands the API until the owner sets the pair: a placeholder site key beside a
        // generated secret. Deployed, no sign-ups; in Development, the test keys, as with nothing set.
        var turnstile = Registered(
            Configuration(("Turnstile:SiteKey", TurnstilePlaceholder.SiteKey), ("Turnstile:SecretKey", "Xq7generated")),
            environment);

        Assert.Equal(environment == "Development" ? TurnstileKeys.AlwaysPasses.SiteKey : null, turnstile.SiteKey);
    }

    [Fact]
    public void AddTurnstile_DeployedWithItsKeys_UsesThem()
    {
        var turnstile = Registered(
            Configuration(("Turnstile:SiteKey", "0x4AAA-site"), ("Turnstile:SecretKey", "0x4AAA-secret")),
            Environments.Production);

        Assert.Equal("0x4AAA-site", turnstile.SiteKey);
    }

    [Theory]
    [InlineData("1x0000000000000000000000000000000AA")]
    [InlineData("2x0000000000000000000000000000000AA")]
    [InlineData("3x0000000000000000000000000000000AA")]
    public void AddTurnstile_DeployedWithATestSecret_RefusesToStart(string secret)
    {
        // A test secret answers the same whoever asks: deployed, that is a sign-up with no check at all.
        var act = () => new ServiceCollection().AddTurnstile(
            Configuration(("Turnstile:SiteKey", "1x00000000000000000000AA"), ("Turnstile:SecretKey", secret)),
            Environment(Environments.Production));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("test secrets", exception.Message);
    }

    [Theory]
    [InlineData("Development", "https://example.com/siteverify")]
    [InlineData("Production", "http://127.0.0.1:5181/turnstile/v0/siteverify")]
    public void AddTurnstile_AStandInAnywhereButThisMachineInDevelopment_RefusesToStart(string environment, string url)
    {
        // Anywhere else, a stand-in that answers yes to every token is a sign-up with no check.
        var act = () => new ServiceCollection().AddTurnstile(
            Configuration(("Turnstile:SiteVerifyUrl", url)), Environment(environment));

        Assert.Throws<InvalidOperationException>(act);
    }

    [Fact]
    public void AddTurnstile_HalfAPair_RefusesToStart()
    {
        var act = () => new ServiceCollection().AddTurnstile(
            Configuration(("Turnstile:SiteKey", "0x4AAA-site")), Environment(Environments.Development));

        Assert.Throws<InvalidOperationException>(act);
    }
}
