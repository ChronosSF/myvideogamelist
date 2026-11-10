namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Who every email is from, and the configuration set SES sends it under, stated once for the API and
/// the CDK app together.
/// </summary>
/// <remarks>
/// The CDK app compiles this file too (<c>infra/src/Infra/Infra.csproj</c>), because the production
/// account's sending role allows <see cref="FromAddress"/> and no other address (ADR 0088), and the
/// production account's email stack makes <see cref="ConfigurationSet"/> (ADR 0091). The API's default
/// <c>Email:From</c> is built from the same constants, and every send names the set, so what the API
/// sends and what the production account allows and expects cannot drift apart. Like
/// <c>SessionLimits.cs</c>, it may use nothing past the base class library.
/// </remarks>
public static class EmailIdentity
{
    /// <summary>The address every email is from.</summary>
    public const string FromAddress = "noreply@myvideogamelist.net";

    /// <summary>The name shown beside it.</summary>
    public const string FromName = "MyVideoGameList";

    /// <summary>
    /// The SES configuration set every email is sent under, in the production account: it keeps any
    /// address that bounced or complained from being sent anything again, and publishes each bounce
    /// and complaint to the owner (ADR 0091).
    /// </summary>
    public const string ConfigurationSet = "mvgl-email";
}
