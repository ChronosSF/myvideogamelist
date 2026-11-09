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
    public string ConfirmEmail(string userId, string token) =>
        $"{Site.GetLeftPart(UriPartial.Authority)}/confirm-email#user={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}";
}

/// <summary>
/// The emails the site sends about an account, composed and handed to the transport.
/// </summary>
/// <remarks>
/// Plain text, deliberately: every mail program shows it, a link in it is clickable in all of them,
/// and there is no markup to build from a username. It says what the email is, why it came, and that
/// ignoring it is safe, as the request to AWS for production access described it (#418).
/// </remarks>
public sealed class AccountEmails(IEmailTransport transport, EmailLinks links)
{
    /// <summary>How long a confirmation link works: Identity's default token lifespan.</summary>
    public const string ConfirmationLifetime = "24 hours";

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
}
