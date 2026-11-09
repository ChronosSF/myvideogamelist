namespace MyVideoGameList.Server.Services.Email;

/// <summary>
/// Who every email is from, stated once for the API and the CDK app together.
/// </summary>
/// <remarks>
/// The CDK app compiles this file too (<c>infra/src/Infra/Infra.csproj</c>), because the production
/// account's sending role allows <see cref="FromAddress"/> and no other address (ADR 0088). The API's
/// default <c>Email:From</c> is built from the same constants, so the address the API sends from and
/// the one the role allows cannot drift apart. Like <c>SessionLimits.cs</c>, it may use nothing past the
/// base class library.
/// </remarks>
public static class EmailIdentity
{
    /// <summary>The address every email is from.</summary>
    public const string FromAddress = "noreply@myvideogamelist.net";

    /// <summary>The name shown beside it.</summary>
    public const string FromName = "MyVideoGameList";
}
