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

    /// <summary>The pace, one per test as the application has one.</summary>
    private static EmailPace Pace(IMemoryCache cache) => new(cache, NullLogger<EmailPace>.Instance);

    private PasswordReset Reset(EmailPace pace) => new(users, Emails(), pace, clock);

    [Fact]
    public async Task SendAsync_WithinThePace_SendsNothingMore()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");

        Assert.Equal(EmailSend.Sent, await Reset(pace).SendAsync(account));
        Assert.Equal(EmailSend.Paced, await Reset(pace).SendAsync(account));
        await transport.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SendAsync_JustAfterAConfirmation_IsNotHeldBackByIt()
    {
        // A reset asked for a minute after signing up is the one email that lets that person in.
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        users.GenerateEmailConfirmationTokenAsync(account).Returns("token");
        var emails = Emails();
        Assert.Equal(EmailSend.Sent, await new AccountConfirmation(users, emails, pace).SendAsync(account));

        Assert.Equal(EmailSend.Sent, await Reset(pace).SendAsync(account));
    }

    [Fact]
    public async Task SendAsync_TheEmailRefused_GivesThePaceBack()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        transport.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new EmailNotSentException("password reset", "refused")), Task.CompletedTask);

        Assert.Equal(EmailSend.Failed, await Reset(pace).SendAsync(account));
        Assert.Equal(EmailSend.Sent, await Reset(pace).SendAsync(account));
    }

    [Fact]
    public async Task SendAsync_TheTokenCannotBeMade_SendsNothingAndGivesThePaceBack()
    {
        // The key ring, unreadable on a deployment whose role cannot reach its store (ADR 0043).
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        var account = NewAccount();
        users.GeneratePasswordResetTokenAsync(account).ThrowsAsync(new CryptographicException("The key ring could not be read."));

        Assert.Equal(EmailSend.Failed, await Reset(pace).SendAsync(account));
        await transport.DidNotReceive().SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());

        users.GeneratePasswordResetTokenAsync(account).Returns("token");
        Assert.Equal(EmailSend.Sent, await Reset(pace).SendAsync(account));
    }

    [Fact]
    public async Task SendAsync_AFailureOfOurOwn_IsThrownOnAndGivesThePaceBack()
    {
        // An account with no address, which the email refuses to compose: a bug, so it is not swallowed,
        // but nothing went, so the account is not held for five minutes either.
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var pace = Pace(cache);
        var account = NewAccount();
        account.Email = null;
        users.GeneratePasswordResetTokenAsync(account).Returns("token");

        await Assert.ThrowsAsync<InvalidOperationException>(() => Reset(pace).SendAsync(account));

        account.Email = "alex@test.local";
        Assert.Equal(EmailSend.Sent, await Reset(pace).SendAsync(account));
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

        using var cache = new MemoryCache(new MemoryCacheOptions());
        var result = await Reset(Pace(cache)).ResetAsync(account, "token", "new-password-1");

        Assert.True(result.Succeeded);
        Assert.NotNull(written);
        Assert.True(written.EmailConfirmed);
        Assert.Equal(0, written.AccessFailedCount);
        Assert.Null(written.LockoutEnd);
        Assert.Equal(clock.GetUtcNow(), written.SessionsEndedAt);
    }

    [Fact]
    public async Task ResetAsync_Refused_PutsTheAccountBackAsItWas()
    {
        // Identity writes nothing for a refused token, and nothing saved later in the request may carry
        // the four fields for it either.
        var account = NewAccount();
        account.AccessFailedCount = 5;
        var lockedUntil = clock.GetUtcNow().AddMinutes(10);
        account.LockoutEnd = lockedUntil;
        users.ResetPasswordAsync(account, "not-the-token", "new-password-1")
            .Returns(IdentityResult.Failed(new IdentityErrorDescriber().InvalidToken()));

        using var cache = new MemoryCache(new MemoryCacheOptions());
        var result = await Reset(Pace(cache)).ResetAsync(account, "not-the-token", "new-password-1");

        Assert.False(result.Succeeded);
        Assert.False(account.EmailConfirmed);
        Assert.Equal(5, account.AccessFailedCount);
        Assert.Equal(lockedUntil, account.LockoutEnd);
        Assert.Null(account.SessionsEndedAt);
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
            { "issued just after the reset from an account read before it", reset, "new", "old", sameSecond.AddSeconds(2), true },
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
            ended == AccountSessions.Ended(sessionsEndedAt, accountStamp, sessionStamp, issuedUtc),
            $"A session {session} should {(ended ? "" : "not ")}have ended.");
    }
}
