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
/// <para>
/// Every account is created here, so this is also where one is dated: when it was created, and when
/// its owner was first seen, which is the same moment (ADR 0051). And where its public id is made sure
/// of: a new <see cref="ApplicationUser"/> draws one, and one a live account already holds is drawn
/// again before the write, so that a collision is a second draw rather than a refused sign-up (ADR 0096).
/// </para>
/// </remarks>
public class UserNameClaimService(UserManager<ApplicationUser> userManager, TimeProvider clock) : IUserNameClaimService
{
    /// <summary>
    /// How many ids registration tries before it gives up. Out of 30^12, with a million accounts, a draw
    /// meets a live account's id about twice in a million million, so meeting five in a row means the
    /// generator is broken, and an exception says so where a loop would hide it.
    /// </summary>
    internal const int PublicIdDraws = 5;

    public async Task<IdentityResult> RegisterAsync(ApplicationUser user, string password)
    {
        var now = clock.GetUtcNow();
        user.CreatedAt = now;
        user.LastSeenAt = now;
        await DrawFreePublicIdAsync(user);
        try
        {
            return await TranslatingTheRace(user, () => userManager.CreateAsync(user, password));
        }
        catch (DbUpdateException)
        {
            // Another registration took the drawn id between the read above and this insert. The
            // account was not written, so it is drawn again once and the write tried once more.
            // Anything else was not this race.
            if (!await PublicIdTakenByAnotherAsync(user)) throw;
            user.PublicId = PublicIdPolicy.New();
            await DrawFreePublicIdAsync(user);
            return await TranslatingTheRace(user, () => userManager.CreateAsync(user, password));
        }
    }

    /// <summary>Whether an account other than this one holds the id this one drew.</summary>
    private async Task<bool> PublicIdTakenByAnotherAsync(ApplicationUser user)
    {
        var (id, publicId) = (user.Id, user.PublicId);
        return await userManager.Users.AnyAsync(u => u.PublicId == publicId && u.Id != id);
    }

    /// <summary>
    /// Keeps the account's public id if no account holds it, and otherwise draws until one is free.
    /// </summary>
    /// <remarks>
    /// A read before the write, which leaves the gap a username's availability check would: two
    /// registrations drawing the same id between this read and their inserts. The unique index refuses
    /// the second, and <see cref="RegisterAsync"/> draws again and retries once.
    /// </remarks>
    private async Task DrawFreePublicIdAsync(ApplicationUser user)
    {
        for (var draw = 1; draw <= PublicIdDraws; draw++)
        {
            var candidate = user.PublicId;
            if (!await userManager.Users.AnyAsync(u => u.PublicId == candidate)) return;
            user.PublicId = PublicIdPolicy.New();
        }

        throw new InvalidOperationException(
            $"Drew {PublicIdDraws} public ids for a new account and every one was taken; the generator is not random.");
    }

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
