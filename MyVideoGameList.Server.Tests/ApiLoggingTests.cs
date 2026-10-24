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
    public void Settings_KeepAspNetsOwnRequestLinesOffAndItsActivityOn(string file)
    {
        // At Information, ASP.NET writes each request's whole URL, query string and all, and a search
        // can be an email address. Asked of the category that writes those lines, so that a rule for it
        // alone, or a level of None, is caught as well: None would stop ASP.NET starting the request's
        // activity, and every line would lose its trace id.
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, file), optional: false)
            .Build();
        using var factory = LoggerFactory.Create(logging => logging
            .AddConfiguration(configuration.GetSection("Logging"))
            .AddProvider(new RecordingLoggerProvider()));

        var requestLines = factory.CreateLogger("Microsoft.AspNetCore.Hosting.Diagnostics");

        Assert.False(requestLines.IsEnabled(LogLevel.Information), $"{file} writes ASP.NET's request lines.");
        Assert.True(requestLines.IsEnabled(LogLevel.Critical), $"{file} switches ASP.NET's hosting log off.");
    }

    [Fact]
    public void AddApiConsole_TheJsonFormatter_WritesOneObjectOnOneLineWithItsScopes()
    {
        // The formatter the provider would use, given an entry with a scope and a thrown exception,
        // whose stack is the thing that spreads across twenty lines in the plain console.
        using var services = Logging(Environments.Production);
        var formatter = services.GetRequiredService<IEnumerable<ConsoleFormatter>>()
            .Single(candidate => candidate.Name == ConsoleFormatterNames.Json);

        var scopes = new LoggerExternalScopeProvider();
        using var _ = scopes.Push(new Dictionary<string, object?> { ["TraceId"] = "4bf92f3577b34da6a3ce929d0e0e4736" });

        using var writer = new StringWriter();
        var entry = new LogEntry<string>(
            LogLevel.Error, "Category", new EventId(1), "It failed",
            Thrown(), (state, _) => state);
        formatter.Write(in entry, scopes, writer);

        var line = writer.ToString().TrimEnd('\r', '\n');
        Assert.DoesNotContain('\n', line);

        // What an HTML page would care about is left alone, so a stack frame reads as written.
        Assert.Contains("A <bug> in Thrown().", line);

        var json = JsonDocument.Parse(line).RootElement;
        Assert.Matches(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$", json.GetProperty("Timestamp").GetString());
        Assert.Equal("Error", json.GetProperty("LogLevel").GetString());
        var exception = json.GetProperty("Exception").GetString();
        Assert.Contains("A <bug> in Thrown().", exception);
        Assert.Contains($"{nameof(ApiLoggingTests)}.{nameof(Thrown)}", exception);
        Assert.Contains(json.GetProperty("Scopes").EnumerateArray(),
            scope => scope.TryGetProperty("TraceId", out var traceId)
                && traceId.GetString() == "4bf92f3577b34da6a3ce929d0e0e4736");
    }

    /// <summary>An exception with a stack, which only a throw gives it.</summary>
    private static Exception Thrown()
    {
        try
        {
            throw new InvalidOperationException("A <bug> in Thrown().");
        }
        catch (InvalidOperationException exception)
        {
            return exception;
        }
    }
}
