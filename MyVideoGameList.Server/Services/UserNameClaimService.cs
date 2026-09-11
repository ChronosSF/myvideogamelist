using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Claims a username through Identity, with the one race Identity does not translate turned into
/// the <see cref="IdentityErrorDescriber.DuplicateUserName"/> error it does.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="UserManager{TUser}"/> answers "is this name free" with a read before the write: its
/// <c>UserValidator</c> looks the name up and reports <c>DuplicateUserName</c> if somebody has it.
/// That covers the ordinary case. It does not cover two people claiming the same name at once, who
/// both pass the read; the unique index over <c>NormalizedUserName</c> then refuses the second
/// write, and the EF store lets that surface as a <see cref="DbUpdateException"/> rather than as an
/// <see cref="IdentityResult"/> — <c>UserStore.CreateAsync</c> catches nothing, and
/// <c>UpdateAsync</c> catches only the concurrency-stamp failure. Left alone, the loser of the race
/// gets a 500 for what is a perfectly ordinary "that one is taken".
/// </para>
/// <para>
/// The race is confirmed by re-reading rather than by matching a provider-specific SQL state,
/// exactly as <see cref="WishlistService"/> does: if the name now belongs to somebody else, that is
/// the answer, and anything else is rethrown because it was not this race. See
/// <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </para>
/// </remarks>
public class UserNameClaimService(UserManager<ApplicationUser> userManager) : IUserNameClaimService
{
    public Task<IdentityResult> RegisterAsync(ApplicationUser user, string password) =>
        TranslatingTheRace(user, () => userManager.CreateAsync(user, password));

    public Task<IdentityResult> RenameAsync(ApplicationUser user, string userName) =>
        TranslatingTheRace(user, () => userManager.SetUserNameAsync(user, userName));

    private async Task<IdentityResult> TranslatingTheRace(
        ApplicationUser user, Func<Task<IdentityResult>> write)
    {
        try
        {
            return await write();
        }
        catch (DbUpdateException)
        {
            // By the time the store throws, the manager has already put the requested name on the
            // user, so this is the name that lost.
            var wanted = user.UserName;
            if (wanted is not null)
            {
                var owner = await userManager.FindByNameAsync(wanted);
                if (owner is not null && owner.Id != user.Id)
                    return IdentityResult.Failed(userManager.ErrorDescriber.DuplicateUserName(wanted));
            }

            throw;
        }
    }
}
