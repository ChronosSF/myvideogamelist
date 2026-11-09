using Amazon.SimpleEmailV2;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using MyVideoGameList.Server.Services.Email;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which sender a process gets. The case that matters most is the one that gets none: a deployment
/// that names no sender must not start, because it would take sign-ups it can never confirm, with a
/// clean log (ADR 0088).
/// </summary>
public class EmailRegistrationTests
{
    private static readonly (string, string)[] Addresses =
    [
        ("Email:From", "MyVideoGameList <noreply@myvideogamelist.net>"),
        ("Email:ReplyTo", "support@myvideogamelist.net"),
    ];

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

    private static Type? Transport(IServiceCollection services) =>
        services.Single(service => service.ServiceType == typeof(IEmailTransport)).ImplementationType;

    [Fact]
    public void AddEmail_DeployedWithNoSender_RefusesToStart()
    {
        var act = () => new ServiceCollection().AddEmail(
            Configuration(Addresses), Environment(Environments.Production));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("Email:Ses:Region", exception.Message);
        Assert.Contains("Email:OutboxPath", exception.Message);
    }

    [Fact]
    public void AddEmail_DeployedWithARegion_SendsThroughSes()
    {
        var services = new ServiceCollection().AddEmail(
            Configuration([.. Addresses, ("Email:Ses:Region", "eu-central-1"), ("Email:SiteUrl", "https://dev.myvideogamelist.net")]),
            Environment(Environments.Production));

        Assert.Equal(typeof(SesEmailTransport), Transport(services));
        Assert.Contains(services, service => service.ServiceType == typeof(IAmazonSimpleEmailServiceV2));
    }

    [Fact]
    public void AddEmail_SesClient_IsInTheConfiguredRegion()
    {
        using var provider = new ServiceCollection()
            .AddEmail(Configuration([.. Addresses, ("Email:Ses:Region", "eu-central-1"), ("Email:SiteUrl", "https://dev.myvideogamelist.net")]), Environment(Environments.Production))
            .BuildServiceProvider();

        var client = provider.GetRequiredService<IAmazonSimpleEmailServiceV2>();

        Assert.Equal("eu-central-1", client.Config.RegionEndpoint.SystemName);
        Assert.Equal(TimeSpan.FromSeconds(10), client.Config.Timeout);
    }

    [Fact]
    public void AddEmail_Development_WritesToTheOutbox()
    {
        var services = new ServiceCollection().AddEmail(
            Configuration(Addresses), Environment(Environments.Development));

        Assert.Null(Transport(services));
        Assert.DoesNotContain(services, service => service.ServiceType == typeof(IAmazonSimpleEmailServiceV2));
        using var provider = services.AddLogging().AddSingleton(TimeProvider.System).BuildServiceProvider();
        Assert.IsType<OutboxEmailTransport>(provider.GetRequiredService<IEmailTransport>());
    }

    [Fact]
    public void AddEmail_DeployedWithAnOutbox_WritesToTheOutbox()
    {
        using var provider = new ServiceCollection()
            .AddEmail(Configuration([.. Addresses, ("Email:OutboxPath", "/tmp/outbox")]), Environment(Environments.Production))
            .AddLogging()
            .AddSingleton(TimeProvider.System)
            .BuildServiceProvider();

        Assert.IsType<OutboxEmailTransport>(provider.GetRequiredService<IEmailTransport>());
    }

    [Fact]
    public void AddEmail_ARegionAndAnOutbox_SesWins()
    {
        // A deployment's setting is never quietly outranked by a folder somebody left configured.
        var services = new ServiceCollection().AddEmail(
            Configuration([.. Addresses, ("Email:Ses:Region", "eu-central-1"), ("Email:SiteUrl", "https://dev.myvideogamelist.net"), ("Email:OutboxPath", "/tmp/outbox")]),
            Environment(Environments.Production));

        Assert.Equal(typeof(SesEmailTransport), Transport(services));
    }

    [Theory]
    [InlineData("Email:From")]
    [InlineData("Email:ReplyTo")]
    public void AddEmail_AMissingAddress_RefusesToStart(string missing)
    {
        var act = () => new ServiceCollection().AddEmail(
            Configuration([.. Addresses.Where(pair => pair.Item1 != missing)]),
            Environment(Environments.Development));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains(missing, exception.Message);
    }

    [Fact]
    public void AddEmail_TheAddresses_AreTheConfiguredOnes()
    {
        using var provider = new ServiceCollection()
            .AddEmail(Configuration(Addresses), Environment(Environments.Development))
            .BuildServiceProvider();

        var sender = provider.GetRequiredService<EmailSender>();
        Assert.Equal("noreply@myvideogamelist.net", sender.From.Address);
        Assert.Equal("MyVideoGameList", sender.From.DisplayName);
        Assert.Equal("support@myvideogamelist.net", sender.ReplyTo.Address);
    }

    [Fact]
    public void AddEmail_SesWithNoSiteUrl_RefusesToStart()
    {
        // A link to the wrong host is a confirmation nobody can finish.
        var act = () => new ServiceCollection().AddEmail(
            Configuration([.. Addresses, ("Email:Ses:Region", "eu-central-1")]),
            Environment(Environments.Production));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("Email:SiteUrl", exception.Message);
    }

    [Fact]
    public void AddEmail_TheOutboxWithNoSiteUrl_LinksToTheDevServer()
    {
        using var provider = new ServiceCollection()
            .AddEmail(Configuration(Addresses), Environment(Environments.Development))
            .BuildServiceProvider();

        Assert.Equal(new Uri("https://localhost:58546"), provider.GetRequiredService<EmailLinks>().Site);
    }

    [Theory]
    [InlineData("dev.myvideogamelist.net")]
    [InlineData("ftp://dev.myvideogamelist.net")]
    [InlineData("https://dev.myvideogamelist.net/app")]
    [InlineData("https://dev.myvideogamelist.net/?a=1")]
    public void AddEmail_ASiteUrlThatIsNotAnOrigin_RefusesToStart(string site)
    {
        var act = () => new ServiceCollection().AddEmail(
            Configuration([.. Addresses, ("Email:SiteUrl", site)]),
            Environment(Environments.Development));

        Assert.Contains("Email:SiteUrl", Assert.Throws<InvalidOperationException>(act).Message);
    }

    [Fact]
    public void ConfirmEmail_PutsTheAccountAndTokenInTheFragment_Escaped()
    {
        var links = new EmailLinks(new Uri("https://dev.myvideogamelist.net/"));

        var link = links.ConfirmEmail("0f8a-id", "CfDJ8+a/b=");

        Assert.Equal("https://dev.myvideogamelist.net/confirm-email#user=0f8a-id&token=CfDJ8%2Ba%2Fb%3D", link);
    }
}
