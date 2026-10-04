using Amazon;
using Amazon.Runtime;
using Amazon.SimpleSystemsManagement;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Security;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The key ring is what makes a cookie readable by the task that did not issue it. A ring that is
/// persisted nowhere fails silently - a clean log and everybody signed out - so the registration
/// has to refuse that case out loud, and has to bind every payload to a name that does not move
/// with the image's working directory.
/// </summary>
public class DataProtectionKeysTests
{
    private static IConfiguration Configuration(params (string Key, string Value)[] settings) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s =>
                new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();

    private static IHostEnvironment Environment(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    private static ServiceCollection Services()
    {
        var services = new ServiceCollection();
        services.AddOptions();
        services.AddLogging();
        return services;
    }

    [Fact]
    public void AddDataProtectionKeys_InDevelopmentWithNoPath_KeepsTheDefaultRingUnderOurName()
    {
        var services = Services();

        services.AddDataProtectionKeys(Configuration(), Environment(Environments.Development));

        using var provider = services.BuildServiceProvider();
        var keys = provider.GetRequiredService<IOptions<KeyManagementOptions>>().Value;
        var discriminator = provider.GetRequiredService<IOptions<DataProtectionOptions>>().Value;

        // No repository of ours: Data Protection falls back to the user-profile ring, which on a
        // developer machine is the one that persists.
        Assert.Null(keys.XmlRepository);
        Assert.Equal(DataProtectionKeys.ApplicationName, discriminator.ApplicationDiscriminator);
    }

    [Fact]
    public void AddDataProtectionKeys_WithAPath_PersistsToParameterStore()
    {
        var services = Services();
        // Registered first so the package's TryAdd leaves it alone: a client that will never be
        // called, because nothing here protects anything, but one whose construction needs no
        // region or credentials from the machine running the tests.
        services.AddSingleton<IAmazonSimpleSystemsManagement>(
            new AmazonSimpleSystemsManagementClient(new AnonymousAWSCredentials(), RegionEndpoint.EUWest1));

        services.AddDataProtectionKeys(
            Configuration(("DataProtection:ParameterPath", "/mvgl/test/data-protection")),
            Environment(Environments.Production));

        using var provider = services.BuildServiceProvider();
        var keys = provider.GetRequiredService<IOptions<KeyManagementOptions>>().Value;
        var discriminator = provider.GetRequiredService<IOptions<DataProtectionOptions>>().Value;

        Assert.NotNull(keys.XmlRepository);
        Assert.Equal("SSMXmlRepository", keys.XmlRepository.GetType().Name);
        Assert.Equal(DataProtectionKeys.ApplicationName, discriminator.ApplicationDiscriminator);
    }

    [Fact]
    public void AddDataProtectionKeys_DeployedWithNoPath_Throws()
    {
        var services = Services();

        var act = () => services.AddDataProtectionKeys(Configuration(), Environment(Environments.Production));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("ParameterPath", exception.Message);
        Assert.Contains("AllowEphemeralKeys", exception.Message);
    }

    [Fact]
    public void AddDataProtectionKeys_DeployedWithNoPathButAcknowledged_KeepsTheDefaultRing()
    {
        var services = Services();

        services.AddDataProtectionKeys(
            Configuration(("DataProtection:AllowEphemeralKeys", "true")),
            Environment(Environments.Production));

        using var provider = services.BuildServiceProvider();
        var keys = provider.GetRequiredService<IOptions<KeyManagementOptions>>().Value;

        Assert.Null(keys.XmlRepository);
    }
}
