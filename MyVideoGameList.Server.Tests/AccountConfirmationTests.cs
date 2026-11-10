using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Email;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The confirmation is sent once the account is written, so nothing about sending it may fail the
/// registration: a token that cannot be made is an email that did not go, and lifts the pace (ADR 0089).
/// </summary>
public class AccountConfirmationTests
{
    private static readonly ApplicationUser Account = new() { Id = "account-1", UserName = "alex", Email = "alex@test.local" };

    private readonly IEmailTransport transport = Substitute.For<IEmailTransport>();

    private readonly UserManager<ApplicationUser> users = Substitute.For<UserManager<ApplicationUser>>(
        Substitute.For<IUserStore<ApplicationUser>>(), null, null, null, null, null, null, null, null);

    /// <summary>The pace, one per test as the application has one: its lock is what makes a claim one step.</summary>
    private static EmailPace Pace(IMemoryCache cache) => new(cache, NullLogger<EmailPace>.Instance);

    private AccountConfirmation Confirmation(EmailPace pace) => new(
        users,
        new AccountEmails(transport, new EmailLinks(new Uri("https://dev.myvideogamelist.net")),
            Options.Create(new DataProtectionTokenProviderOptions()),
            Options.Create(new PasswordResetTokenProviderOptions())),
        pace);

    [Fact]
    public async Task SendAsync_TheTokenCannotBeMade_FailsAndLiftsThePace()
    {
        // The key ring, unreadable on a deployment whose role cannot reach its store (ADR 0043).
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        users.GenerateEmailConfirmationTokenAsync(Account).ThrowsAsync(new CryptographicException("The key ring could not be read."));

        Assert.Equal(EmailSend.Failed, await Confirmation(pace).SendAsync(Account));

        users.GenerateEmailConfirmationTokenAsync(Account).Returns("token");
        Assert.Equal(EmailSend.Sent, await Confirmation(pace).SendAsync(Account));
        await transport.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendAsync_WithinThePace_SendsNothingMore()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        users.GenerateEmailConfirmationTokenAsync(Account).Returns("token");

        Assert.Equal(EmailSend.Sent, await Confirmation(pace).SendAsync(Account));
        Assert.Equal(EmailSend.Paced, await Confirmation(pace).SendAsync(Account));
        await transport.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendAsync_ManyAtOnce_SendsOne()
    {
        // The claim is one step: the cache's own GetOrCreate would let simultaneous callers all send.
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        users.GenerateEmailConfirmationTokenAsync(Account).Returns("token");
        using var start = new ManualResetEventSlim();

        var callers = Enumerable.Range(0, 32).Select(_ => Task.Run(() =>
        {
            start.Wait();
            return Confirmation(pace).SendAsync(Account);
        })).ToArray();
        start.Set();
        var sends = await Task.WhenAll(callers);

        Assert.Single(sends, send => send == EmailSend.Sent);
        await transport.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendConfirmationAsync_SaysHowLongTheTokenProviderKeepsTheLink()
    {
        // The email cannot promise longer than the link lasts.
        EmailMessage? sent = null;
        await transport.SendAsync(Arg.Do<EmailMessage>(message => sent = message), Arg.Any<CancellationToken>());
        var emails = new AccountEmails(transport, new EmailLinks(new Uri("https://dev.myvideogamelist.net")),
            Options.Create(new DataProtectionTokenProviderOptions { TokenLifespan = TimeSpan.FromHours(2) }),
            Options.Create(new PasswordResetTokenProviderOptions()));

        await emails.SendConfirmationAsync(Account, "token", CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Contains("The link works for 2 hours.", sent.Text);
    }

    [Theory]
    [InlineData(1440, "24 hours")]
    [InlineData(60, "1 hour")]
    [InlineData(90, "90 minutes")]
    [InlineData(30, "30 minutes")]
    public void InWords_SaysALifespanAsTheEmailDoes(int minutes, string expected) =>
        Assert.Equal(expected, AccountEmails.InWords(TimeSpan.FromMinutes(minutes)));
}
