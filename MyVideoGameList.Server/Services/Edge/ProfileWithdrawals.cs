using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// What happened to a review that may take back something a public profile published.
/// </summary>
public enum ReviewWithdrawal
{
    /// <summary>Public until this save, which rewrote it and set it to private.</summary>
    MadePrivate,

    /// <summary>
    /// Public until this save and still public, with different words or a spoiler warning added or
    /// taken off: the edge holds what its author has taken back.
    /// </summary>
    Edited,

    /// <summary>
    /// Deleted, whether or not it was public when the delete read it: another of its author's
    /// requests can publish it between that read and the delete (ADR 0058 §1).
    /// </summary>
    Deleted,
}

/// <summary>
/// Which writes withdraw something a public profile published, and what each one takes off the
/// edge.
/// </summary>
/// <remarks>
/// <para>
/// A public profile is shared-cacheable for five minutes and servable stale for an hour after
/// that (<c>CACHE_PROFILE</c>, ADR 0027 §10), and so is the profile sitemap file that lists it
/// (ADR 0036 §5). That window is acceptable for content — a new score, a finished game — and not
/// for consent: a profile switched back to private, renamed or deleted, or a review made private,
/// edited or deleted, should stop being served when its owner says so. Those six are the events,
/// with a seventh that can be one of them: everything recorded about a game deleted, which takes
/// its review with it. Nothing else is. A favourite removed, a score changed, a statistic that
/// moved: those are a profile's content changing, and they keep the window (ADR 0029).
/// </para>
/// <para>
/// <b>Every method is called after the write has committed, and none of them can fail it.</b>
/// Whatever <see cref="IEdgeInvalidator"/> throws is caught and logged here, deliberately: a
/// withdrawal that reached our tables has taken effect for every request that reaches the origin,
/// and refusing it because CloudFront did not answer would turn a stale edge into a consent that
/// cannot be withdrawn at all.
/// </para>
/// <para>
/// Each event is one <see cref="EdgeInvalidation"/>, and so one CloudFront request: the page, its
/// <c>.data</c> URL and, for the three events that change who is listed, the profile sitemap files.
/// See <c>docs/decisions/0058-a-withdrawal-leaves-the-edge-when-it-is-made.md</c>.
/// </para>
/// <para>
/// <b>A class rather than an interface, on purpose.</b> This is where the guarantee that a
/// withdrawal never fails its write lives, so it is not something to swap out; the seam for a test,
/// and for the choice between CloudFront and a log, is <see cref="IEdgeInvalidator"/> underneath it.
/// </para>
/// </remarks>
public sealed class ProfileWithdrawals(
    ApplicationDbContext db,
    IEdgeInvalidator edge,
    ILogger<ProfileWithdrawals> logger)
{
    /// <summary>
    /// Every profile sitemap file: <c>/sitemaps/profiles-1.xml</c>, <c>-2</c> and so on.
    /// </summary>
    /// <remarks>
    /// One path for all of them, since a withdrawal shifts every name after it into a different
    /// file. Not <c>profiles-*.xml</c>: CloudFront honours a <c>*</c> only as the last character
    /// of a path and matches one anywhere else as a literal asterisk, so that path would
    /// invalidate nothing and say nothing about it.
    /// </remarks>
    internal const string ProfileSitemaps = "/sitemaps/profiles-*";

    /// <summary>
    /// Everything the edge can hold for one profile: <c>/u/{name}</c>, <c>/u/{name}.data</c>, and
    /// both again with any query string.
    /// </summary>
    /// <remarks>
    /// <para>
    /// One wildcard rather than the two paths the issue names, because the cache key holds
    /// <c>page</c> (each page of reviews is its own document, ADR 0027 §9) and React Router's
    /// <c>_routes</c>, and CloudFront invalidates a path with a query string only when that query
    /// string is named or a <c>*</c> stands in for it. A withdrawn review on page three would
    /// otherwise stay there. React Router 8 asks for a document's data at the same path with
    /// <c>.data</c> on the end — <c>/u/alice.data</c>, <c>/u/alice.data?page=2</c>, and
    /// <c>/u/alice/_.data</c> for the trailing-slash form — so the prefix covers those too.
    /// </para>
    /// <para>
    /// It also covers any other name that starts with this one: <c>/u/alice*</c> takes
    /// <c>/u/alice_2</c> with it. That costs those pages one trip to the origin, which is cheaper
    /// than counting pages to name each one, and a path is a path on the bill whatever it matches.
    /// What it does not cover is the same name in other letter case: the lookup ignores case, so
    /// <c>/u/ALICE</c> renders this profile, but an invalidation path is case-sensitive. The site
    /// links only to the name as its owner wrote it, and a change of case invalidates both
    /// spellings, so such a copy comes from a link somebody typed or kept from before a change of
    /// case, and it keeps the old window. ADR 0058 records the trade.
    /// </para>
    /// <para>
    /// Escaped although no name needs it — the alphabet is letters, digits and the underscore — so
    /// that the day the alphabet grows, the path is still the one the page is cached under.
    /// </para>
    /// </remarks>
    internal static string Profile(string userName) => $"/u/{Uri.EscapeDataString(userName)}*";

    /// <summary>A public profile switched to anything that is not public.</summary>
    public void ProfileMadePrivate(string userName) =>
        Send("profile made private", Profile(userName), ProfileSitemaps);

    /// <summary>
    /// A public profile moved to a different name: the old one, which is released for somebody else
    /// to claim, and the new one, whose edge may hold a 404 from before it was taken. Also a change
    /// of letter case only, which releases nothing but leaves the old spelling's copies where no
    /// later withdrawal, naming the new one, would reach them.
    /// </summary>
    public void ProfileRenamed(string from, string to) =>
        Send("profile renamed", Profile(from), Profile(to), ProfileSitemaps);

    /// <summary>An account whose profile was public, deleted.</summary>
    public void AccountDeleted(string userName) =>
        Send("account deleted", Profile(userName), ProfileSitemaps);

    /// <summary>
    /// A review made private or edited while it was public, or deleted whatever it was.
    /// Invalidates the author's profile if that profile is public now.
    /// </summary>
    public Task ReviewWithdrawnAsync(string userId, ReviewWithdrawal withdrawal) =>
        ProfileChangedAsync(userId, withdrawal switch
        {
            ReviewWithdrawal.MadePrivate => "review made private",
            ReviewWithdrawal.Edited => "review edited",
            _ => "review deleted",
        });

    /// <summary>
    /// Everything recorded about a game deleted, whatever it held. Invalidates the owner's profile
    /// if that profile is public now.
    /// </summary>
    /// <remarks>
    /// Whether the entry carried a public review, or any review, is deliberately not asked. The
    /// cascade takes whatever review the entry has when the row goes, and the owner's own request
    /// can write one or publish one between any question asked before the delete and the delete
    /// itself; afterwards there is nothing left to ask. So a game with no review costs a path too
    /// (ADR 0058 §1).
    /// </remarks>
    public Task EntryDeletedAsync(string userId) => ProfileChangedAsync(userId, "entry deleted");

    /// <summary>
    /// Invalidates the profile of the account a write has just changed, if that profile is public
    /// now; a private one serves nothing to withdraw.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The name and visibility are read here, after the write, rather than handed in from before
    /// it. A rename landing between the two is then answered under the name the profile has now,
    /// since the rename itself took the old one off the edge. And a profile made private between
    /// them is left to the invalidation that change sent.
    /// </para>
    /// <para>
    /// <b>No cancellation token, on purpose.</b> This runs after the write has committed, and the
    /// request's token is cancelled when the reader closes the tab. Passing it would let a closed
    /// tab cancel the one thing that makes the withdrawal reach the edge, after the database
    /// already holds it — an invalidation is owed whether or not anybody waits for the response.
    /// </para>
    /// </remarks>
    private async Task ProfileChangedAsync(string userId, string reason)
    {
        try
        {
            var owner = await db.Users
                .AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => new { u.UserName, u.ProfileVisibility })
                .FirstOrDefaultAsync(CancellationToken.None);

            if (owner?.UserName is not { } userName
                || owner.ProfileVisibility != ProfileVisibility.Public)
            {
                return;
            }

            Send(reason, Profile(userName));
        }
        catch (Exception e)
        {
            // Swallowed deliberately, like everything after the commit: what was withdrawn is
            // already gone for every request that reaches the origin, and the edge keeps its copy
            // for at most the window it had before this existed.
            logger.LogError(e,
                "Could not look up account {UserId} after a withdrawal ({Reason}); "
                + "their profile was not invalidated and stays at the edge until its TTL runs out.",
                userId, reason);
        }
    }

    private void Send(string reason, params string[] paths)
    {
        var invalidation = new EdgeInvalidation(reason, paths);
        try
        {
            edge.Invalidate(invalidation);
        }
        catch (Exception e)
        {
            // Deliberately not rethrown. The write this follows has committed, and an exception
            // here would report a consent change that did take effect as one that failed.
            logger.LogError(e,
                "Could not hand {Paths} to the edge invalidator ({Reason}); they stay at the edge until their TTL runs out.",
                invalidation.PathsForLog, reason);
        }
    }
}
