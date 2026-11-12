using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// How long a password reset's link works, and under what name its token is protected: an hour, where a
/// confirmation's works for Identity's day (ADR 0090).
/// </summary>
/// <remarks>
/// A type of its own, rather than <see cref="DataProtectionTokenProviderOptions"/> configured again,
/// because those options are the default provider's, which still issues the confirmation's token. The
/// reset email reads this type, so it says how long the link works by asking the provider that makes it.
/// </remarks>
public sealed class PasswordResetTokenProviderOptions : DataProtectionTokenProviderOptions
{
    public PasswordResetTokenProviderOptions()
    {
        Name = "PasswordResetTokenProvider";
        TokenLifespan = TimeSpan.FromHours(1);
    }
}

/// <summary>Identity's data-protection token, under <see cref="PasswordResetTokenProviderOptions"/>.</summary>
public sealed class PasswordResetTokenProvider(
    IDataProtectionProvider dataProtectionProvider,
    IOptions<PasswordResetTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<ApplicationUser>> logger)
    : DataProtectorTokenProvider<ApplicationUser>(dataProtectionProvider, options, logger);

public static class PasswordResetTokens
{
    /// <summary>The name Identity knows the provider by.</summary>
    public const string ProviderName = "PasswordReset";

    /// <summary>
    /// Makes <see cref="PasswordResetTokenProvider"/> the one that issues and checks a reset's token.
    /// </summary>
    /// <remarks>
    /// The provider and the option that names it are set here together, so that the email's "the link
    /// works for" and the token's real life cannot come from two places. The integration suite's
    /// <c>PasswordResetFlowTests</c> reads the application's own options and checks that they agree.
    /// </remarks>
    public static IdentityBuilder AddPasswordResetTokens(this IdentityBuilder builder)
    {
        builder.AddTokenProvider<PasswordResetTokenProvider>(ProviderName);
        builder.Services.Configure<IdentityOptions>(options => options.Tokens.PasswordResetTokenProvider = ProviderName);
        return builder;
    }
}
