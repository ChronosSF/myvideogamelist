using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Email;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A forgotten password: one link every few minutes at most, on a pace of its own, and a reset that
/// confirms the address, ends the lockout and ends every session in the one write it makes (ADR 0090).
/// </summary>
public class PasswordResetTests
{
    private static ApplicationUser NewAccount() =>
        new() { Id = "account-1", UserName = "alex", Email = "alex@test.local" };

    private readonly IEmailTransport transport = Substitute.For<IEmailTransport>();

    private readonly UserManager<ApplicationUser> users = Substitute.For<UserManager<ApplicationUser>>(
        Substitute.For<IUserStore<ApplicationUser>>(), null, null, null, null, null, null, null, null);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private readonly FixedClock clock = new(new DateTimeOffset(2026, 11, 10, 12, 0, 0, TimeSpan.Zero));

    private AccountEmails Emails(TimeSpan? resetLifespan = null) => new(
        transport,
        new EmailLinks(new Uri("https://dev.myvideogamelist.net")),
        Options.Create(new DataProtectionTokenProviderOptions()),
        Options.Create(resetLifespan is { } lifespan
            ? new PasswordResetTokenProviderOptions { TokenLifespan = lifespan }
            : new PasswordResetTokenProviderOptions()));

    private PasswordReset Reset(IMemoryCache cache) =>
        new(users, Emails(), cache, clock, NullLogger<PasswordReset>.Instance);

    [Fact]
    public async Task SendAsync_WithinThePace_SendsNothingMore()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");

        Assert.True(await Reset(cache).SendAsync(account));
        Assert.False(await Reset(cache).SendAsync(account));
        await transport.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendAsync_JustAfterAConfirmation_IsNotHeldBackByIt()
    {
        // A reset asked for a minute after signing up is the one email that lets that person in.
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        Assert.True(EmailPace.TryClaim(cache, "confirmation", account.Id));

        Assert.True(await Reset(cache).SendAsync(account));
    }

    [Fact]
    public async Task SendAsync_TheEmailRefused_LiftsThePace()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        transport.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new EmailNotSentException("password reset", "refused")), Task.CompletedTask);

        Assert.False(await Reset(cache).SendAsync(account));
        Assert.True(await Reset(cache).SendAsync(account));
    }

    [Fact]
    public async Task SendAsync_TheTokenCannotBeMade_SendsNothingAndLiftsThePace()
    {
        // The key ring, unreadable on a deployment whose role cannot reach its store (ADR 0043).
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).ThrowsAsync(new CryptographicException("The key ring could not be read."));

        Assert.False(await Reset(cache).SendAsync(account));
        await transport.DidNotReceive().SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());

        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        Assert.True(await Reset(cache).SendAsync(account));
    }

    [Fact]
    public async Task SendPasswordResetAsync_SaysHowLongTheResetsOwnProviderKeepsTheLink()
    {
        // The reset's provider, not the default one that issues the confirmation's token for a day.
        EmailMessage? sent = null;
        await transport.SendAsync(Arg.Do<EmailMessage>(message => sent = message), Arg.Any<CancellationToken>());

        await Emails(TimeSpan.FromMinutes(45)).SendPasswordResetAsync(NewAccount(), "a+b/c=", CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal("password reset", sent.Purpose);
        Assert.Equal("alex@test.local", sent.To);
        Assert.Contains("The link works for 45 minutes, and only once.", sent.Text);
        Assert.Contains("https://dev.myvideogamelist.net/reset-password#user=account-1&token=a%2Bb%2Fc%3D", sent.Text);
    }

    [Fact]
    public void PasswordResetTokenProviderOptions_AnHourUnderANameOfItsOwn()
    {
        var options = new PasswordResetTokenProviderOptions();

        Assert.Equal(TimeSpan.FromHours(1), options.TokenLifespan);
        Assert.NotEqual(new DataProtectionTokenProviderOptions().Name, options.Name);
    }

    [Fact]
    public async Task ResetAsync_HandsIdentityTheAccountAlreadyConfirmedUnlockedAndEnded()
    {
        // Identity's one write carries them, so a reset never half happens.
        var account = NewAccount();
        account.AccessFailedCount = 4;
        account.LockoutEnd = clock.GetUtcNow().AddMinutes(10);
        ApplicationUser? written = null;
        users.ResetPasswordAsync(Arg.Do<ApplicationUser>(user => written = new ApplicationUser
        {
            EmailConfirmed = user.EmailConfirmed,
            AccessFailedCount = user.AccessFailedCount,
            LockoutEnd = user.LockoutEnd,
            SessionsEndedAt = user.SessionsEndedAt,
        }), "token", "new-password-1").Returns(IdentityResult.Success);

        var result = await Reset(new MemoryCache(new MemoryCacheOptions())).ResetAsync(account, "token", "new-password-1");

        Assert.True(result.Succeeded);
        Assert.NotNull(written);
        Assert.True(written.EmailConfirmed);
        Assert.Equal(0, written.AccessFailedCount);
        Assert.Null(written.LockoutEnd);
        Assert.Equal(clock.GetUtcNow(), written.SessionsEndedAt);
    }

    public static TheoryData<string, DateTimeOffset?, string?, string?, DateTimeOffset?, bool> Sessions()
    {
        var reset = new DateTimeOffset(2026, 11, 10, 12, 0, 0, 400, TimeSpan.Zero);
        var sameSecond = new DateTimeOffset(2026, 11, 10, 12, 0, 0, TimeSpan.Zero);
        return new()
        {
            { "never reset", null, "new", "old", sameSecond.AddDays(-1), false },
            { "from before the reset", reset, "new", "old", sameSecond.AddMinutes(-5), true },
            { "from the reset's own second, under the old stamp", reset, "new", "old", sameSecond, true },
            { "from the reset's own second, under the new stamp", reset, "new", "new", sameSecond, false },
            { "from after the reset, under a later rename's stamp", reset, "renamed", "new", sameSecond.AddMinutes(5), false },
            { "from before the reset, under the stamp it still has", reset, "same", "same", sameSecond.AddMinutes(-5), false },
            { "saying nothing of when it began", reset, "new", "old", null, true },
        };
    }

    [Theory]
    [MemberData(nameof(Sessions))]
    public void Ended_ASessionAgainstTheAccountsLastReset_EndsOnlyWhatCameBefore(
        string session, DateTimeOffset? sessionsEndedAt, string? accountStamp, string? sessionStamp,
        DateTimeOffset? issuedUtc, bool ended)
    {
        Assert.True(
            ended == DeletedAccountSessions.Ended(sessionsEndedAt, accountStamp, sessionStamp, issuedUtc),
            $"A session {session} should {(ended ? "" : "not ")}have ended.");
    }
}
