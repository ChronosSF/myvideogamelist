using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Tests;

/// <summary>An edge that remembers every invalidation it was handed, in order.</summary>
internal sealed class RecordingEdgeInvalidator : IEdgeInvalidator
{
    public List<EdgeInvalidation> Sent { get; } = [];

    public void Invalidate(EdgeInvalidation invalidation) => Sent.Add(invalidation);
}

/// <summary>An edge whose every call fails, as one would whose implementation had a bug in it.</summary>
internal sealed class ThrowingEdgeInvalidator : IEdgeInvalidator
{
    public int Calls { get; private set; }

    public void Invalidate(EdgeInvalidation invalidation)
    {
        Calls++;
        throw new InvalidOperationException("The edge is not answering.");
    }
}

/// <summary>
/// The <see cref="ProfileWithdrawals"/> every service that writes a review or an entry now needs,
/// for the tests that are about something else.
/// </summary>
internal static class EdgeFakes
{
    public static ProfileWithdrawals Withdrawals(ApplicationDbContext db, IEdgeInvalidator? edge = null) =>
        new(db, edge ?? new RecordingEdgeInvalidator(), NullLogger<ProfileWithdrawals>.Instance);
}
