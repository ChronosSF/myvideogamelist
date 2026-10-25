using Microsoft.AspNetCore.Authentication.Cookies;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// The cookie that says a browser is signed in and nothing about who: what the edge keeps two copies of the
/// home page by, and what the page's server render reads to pick its top section (ADR 0074).
/// </summary>
/// <remarks>
/// <para>
/// It names nobody, so a shared cache may key on it: both copies are the same for everybody they are served
/// to. The session cookie never enters a cache key. Faking the flag gets only the signed-in copy's
/// placeholders, which turn into the visitor's page as soon as <c>/api/auth/me</c> answers.
/// </para>
/// <para>
/// It follows the session rather than leading it: written by the sign-in cookie's own events, so every
/// way in and out — a registration, a sign-in, a rename's refreshed sign-in, a sign-out, an account
/// deleted, a session refused for a changed security stamp — moves it with the session; and kept in
/// step by <c>/api/auth/me</c>, which every page load asks, for a session that slides past the flag's
/// expiry or ends without a sign-out. Wrong, it costs one page load: the wrong top section, replaced
/// when auth answers, as every page load was before.
/// </para>
/// <para>
/// HttpOnly, because only the server reads it. Secure and Lax, as the session cookie is.
/// </para>
/// </remarks>
public static class SignedInFlag
{
    /// <summary>The cookie's name. The client's <c>@/lib/signedInFlag</c> and the edge's home behaviour say it too.</summary>
    public const string CookieName = "mvgl_signed_in";

    private const string Value = "1";

    public static bool IsSet(HttpRequest request) => request.Cookies[CookieName] == Value;

    /// <param name="expires">The session's own expiry, or null for a session that ends with the browser.</param>
    public static void Set(HttpResponse response, DateTimeOffset? expires) =>
        response.Cookies.Append(CookieName, Value, Options(expires));

    public static void Clear(HttpResponse response) => response.Cookies.Delete(CookieName, Options(null));

    /// <summary>Moves the flag with the sign-in cookie, on its own events.</summary>
    public static void FollowTheSession(CookieAuthenticationEvents events)
    {
        events.OnSignedIn = context =>
        {
            // A persistent session's expiry is on its properties by now; the fallback is the handler's own
            // rule, should a later version stop putting it there.
            var expires = context.Properties.IsPersistent
                ? context.Properties.ExpiresUtc ?? DateTimeOffset.UtcNow.Add(context.Options.ExpireTimeSpan)
                : (DateTimeOffset?)null;
            Set(context.Response, expires);
            return Task.CompletedTask;
        };

        events.OnSigningOut = context =>
        {
            Clear(context.Response);
            return Task.CompletedTask;
        };
    }

    private static CookieOptions Options(DateTimeOffset? expires) => new()
    {
        Path = "/",
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Expires = expires,
        // Needed for the page to be drawn right, as the session cookie is, so never held back for consent.
        IsEssential = true,
    };
}
