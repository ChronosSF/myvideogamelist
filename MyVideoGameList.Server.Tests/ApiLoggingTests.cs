using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Observability;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the API's console says, and in what shape: CloudWatch makes an event of every line, and can
/// query a field only when that line is a JSON object.
/// </summary>
public class ApiLoggingTests
{
    private static ServiceProvider Logging(string environmentName)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(environmentName);

        var services = new ServiceCollection();
        services.AddLogging(logging => logging.AddConsole().AddApiConsole(environment));
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddApiConsole_OutsideDevelopment_WritesJsonWithEveryScope()
    {
        using var services = Logging(Environments.Production);

        var console = services.GetRequiredService<IOptionsMonitor<ConsoleLoggerOptions>>().CurrentValue;
        var json = services.GetRequiredService<IOptionsMonitor<JsonConsoleFormatterOptions>>().CurrentValue;

        Assert.Equal(ConsoleFormatterNames.Json, console.FormatterName);
        Assert.True(json.IncludeScopes);
        Assert.True(json.UseUtcTimestamp);
        Assert.Equal(ApiLogging.TimestampFormat, json.TimestampFormat);
        Assert.False(json.JsonWriterOptions.Indented);
    }

    [Fact]
    public void AddApiConsole_InDevelopment_KeepsThePlainConsole()
    {
        using var services = Logging(Environments.Development);

        var console = services.GetRequiredService<IOptionsMonitor<ConsoleLoggerOptions>>().CurrentValue;

        Assert.NotEqual(ConsoleFormatterNames.Json, console.FormatterName);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    public void AddApiConsole_InEitherEnvironment_PutsTheTraceIdInEveryLinesScopes(string environmentName)
    {
        using var services = Logging(environmentName);

        var tracking = services.GetRequiredService<IOptions<LoggerFactoryOptions>>().Value.ActivityTrackingOptions;

        Assert.True(tracking.HasFlag(ActivityTrackingOptions.TraceId));
    }

    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Development.json")]
    public void Settings_KeepAspNetsOwnRequestLinesOff(string file)
    {
        // At Information, ASP.NET writes each request's whole URL, query string and all, and a search
        // can be an email address. The application's own request line leaves the query out.
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false)
            .Build();

        var level = Enum.Parse<LogLevel>(configuration["Logging:LogLevel:Microsoft.AspNetCore"] ?? "Trace");

        Assert.True(level >= LogLevel.Warning, $"{file} logs Microsoft.AspNetCore at {level}.");
    }

    [Fact]
    public void AddApiConsole_TheJsonFormatter_WritesOneObjectOnOneLineWithItsScopes()
    {
        // The formatter the provider would use, given an entry with a scope and an exception, which
        // is the case that spreads across a screen in the plain console.
        using var services = Logging(Environments.Production);
        var formatter = services.GetRequiredService<IEnumerable<ConsoleFormatter>>()
            .Single(candidate => candidate.Name == ConsoleFormatterNames.Json);

        var scopes = new LoggerExternalScopeProvider();
        using var _ = scopes.Push(new Dictionary<string, object?> { ["TraceId"] = "4bf92f3577b34da6a3ce929d0e0e4736" });

        using var writer = new StringWriter();
        var entry = new LogEntry<string>(
            LogLevel.Error, "Category", new EventId(1), "It failed",
            new InvalidOperationException("A bug."), (state, _) => state);
        formatter.Write(in entry, scopes, writer);

        var line = writer.ToString().TrimEnd('\r', '\n');
        Assert.DoesNotContain('\n', line);

        var json = JsonDocument.Parse(line).RootElement;
        Assert.Matches(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$", json.GetProperty("Timestamp").GetString());
        Assert.Equal("Error", json.GetProperty("LogLevel").GetString());
        Assert.Contains("A bug.", json.GetProperty("Exception").GetString());
        Assert.Contains(json.GetProperty("Scopes").EnumerateArray(),
            scope => scope.TryGetProperty("TraceId", out var traceId)
                && traceId.GetString() == "4bf92f3577b34da6a3ce929d0e0e4736");
    }
}
