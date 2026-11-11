namespace MyVideoGameList.Server.Security;

/// <summary>
/// What an environment's Turnstile secret holds before its owner has set the widget's pair, stated once
/// for the API and the CDK app together (ADR 0092).
/// </summary>
/// <remarks>
/// The Data stack makes <c>mvgl/&lt;env&gt;/turnstile</c> before anybody has a pair to put in it, with
/// <see cref="SiteKey"/> beside a generated secret, and the App stack hands both to the API. The API
/// reads that as no keys at all (<c>TurnstileRegistration</c>): otherwise it would hand the page
/// a site key Cloudflare has never heard of and ask Cloudflare with a secret nobody was given. The CDK
/// app compiles this file too (<c>infra/src/Infra/Infra.csproj</c>), so what the stack writes and what
/// the API recognises cannot drift apart. Like <c>SessionLimits.cs</c>, it may use nothing past the base
/// class library.
/// </remarks>
public static class TurnstilePlaceholder
{
    /// <summary>The site key of a pair nobody has set.</summary>
    public const string SiteKey = "set-me";
}
