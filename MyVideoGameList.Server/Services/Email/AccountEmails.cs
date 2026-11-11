using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Where the links in an email lead: the site's origin, as the reader's browser reaches it.
/// </summary>
/// <remarks>
/// <para>
/// Configuration, never the request's host. A link built from the <c>Host</c> header is a link an
/// attacker can point at a site of their own, carrying a token meant for somebody else.
/// </para>
/// <para>
/// <b>A token travels in the fragment, after the <c>#</c>.</b> A browser never sends a fragment: not
/// to the server, so the token is in no request log, the SSR server's included, which writes every
/// page's whole URL (#407); not to a CDN, so it is in no cache key; and not in a
/// <c>Referer</c>. The page reads it after hydration and posts it to the API. See ADR 0089.
/// </para>
/// </remarks>
public sealed record EmailLinks(Uri Site)
{
    /// <summary>The page that confirms an address, with the account and its token.</summary>
    public string ConfirmEmail(string userId, string token) => Link("confirm-email", userId, token);

    /// <summary>The page that sets a new password, with the account and its token (ADR 0090).</summary>
    public string ResetPassword(string userId, string token) => Link("reset-password", userId, token);

    /// <summary>A page of the site, with an account and its token after the <c>#</c>, as both pages read them.</summary>
    private string Link(string page, string userId, string token) =>
        $"{Site.GetLeftPart(UriPartial.Authority)}/{page}#user={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}";
}

/// <summary>
/// The emails the site sends about an account, composed and handed to the transport.
/// </summary>
/// <remarks>
/// Plain text, deliberately: every mail program shows it, a link in it is clickable in all of them,
/// and there is no markup to build from a username. It says what the email is, why it came, and that
/// ignoring it is safe, as the request to AWS for production access described it (#418).
/// </remarks>
public sealed class AccountEmails(
    IEmailTransport transport,
    EmailLinks links,
    IOptions<DataProtectionTokenProviderOptions> tokens,
    IOptions<PasswordResetTokenProviderOptions> resetTokens)
{
    /// <summary>
    /// How long a link works, in words: the token provider's lifespan, which is what decides it, so
    /// that the email cannot promise longer than the link lasts.
    /// </summary>
    private string ConfirmationLifetime => InWords(tokens.Value.TokenLifespan);

    /// <summary>
    /// The same for a reset's link, from the provider that issues a reset's token, which is not the
    /// confirmation's (ADR 0090).
    /// </summary>
    private string ResetLifetime => InWords(resetTokens.Value.TokenLifespan);

    /// <summary>A lifespan as the email says it: in whole hours, or in minutes when it is not.</summary>
    internal static string InWords(TimeSpan lifespan) =>
        lifespan.TotalHours >= 1 && lifespan.Ticks % TimeSpan.TicksPerHour == 0
            ? $"{(long)lifespan.TotalHours} {((long)lifespan.TotalHours == 1 ? "hour" : "hours")}"
            : $"{(long)Math.Ceiling(lifespan.TotalMinutes)} minutes";

    public Task SendConfirmationAsync(ApplicationUser user, string token, CancellationToken cancellationToken) =>
        transport.SendAsync(new EmailMessage(
            Purpose: "account confirmation",
            To: user.Email ?? throw new InvalidOperationException("An account with no address cannot be confirmed."),
            Subject: "Confirm your email address for MyVideoGameList",
            Text: $"""
                Hello {user.UserName},

                Thanks for signing up to MyVideoGameList. To finish creating your account, confirm that this is your email address:

                {links.ConfirmEmail(user.Id, token)}

                The link works for {ConfirmationLifetime}. If you did not sign up, you can ignore this email: without the confirmation the account cannot be used.

                MyVideoGameList
                """), cancellationToken);

    /// <summary>
    /// The link that sets a new password, sent because somebody asked for it with this account's
    /// address or username, who may not be its owner. So it says that nothing changes until the link is
    /// used, and the owner can ignore it.
    /// </summary>
    public Task SendPasswordResetAsync(ApplicationUser user, string token, CancellationToken cancellationToken) =>
        transport.SendAsync(new EmailMessage(
            Purpose: "password reset",
            To: user.Email ?? throw new InvalidOperationException("An account with no address cannot be sent a reset."),
            Subject: "Reset your MyVideoGameList password",
            Text: $"""
                Hello {user.UserName},

                Somebody asked to reset the password of your MyVideoGameList account. If it was you, choose a new password here:

                {links.ResetPassword(user.Id, token)}

                The link works for {ResetLifetime}, and only once. Setting a new password signs you out everywhere you are signed in.

                If you did not ask, you can ignore this email: your password stays as it is.

                MyVideoGameList
                """), cancellationToken);
}
