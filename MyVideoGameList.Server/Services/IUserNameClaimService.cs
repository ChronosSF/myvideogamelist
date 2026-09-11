using Microsoft.AspNetCore.Identity;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The two writes that claim a username: registering an account with one, and renaming an account
/// to another. Both report a name somebody else holds as <c>DuplicateUserName</c>, including when
/// that somebody claimed it a moment ago.
/// </summary>
public interface IUserNameClaimService
{
    /// <summary>Creates the account, with the username already set on it.</summary>
    Task<IdentityResult> RegisterAsync(ApplicationUser user, string password);

    /// <summary>Moves the account to a different username.</summary>
    Task<IdentityResult> RenameAsync(ApplicationUser user, string userName);
}
