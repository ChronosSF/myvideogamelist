using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The model and the migrations say the same thing.
/// </summary>
/// <remarks>
/// <para>
/// Every other test here runs on the in-memory provider, which has no migrations, so nothing else would
/// notice a model changed without one — a column, an index, or a check constraint whose SQL is built at
/// runtime, as the hand order's is. Two such checks share one expression (ADR 0064), and an expression
/// formatted in a culture with another minus sign was a model that no longer matched the migrations
/// (review of #117). This is the comparison <c>dotnet ef migrations add</c> makes before it writes one.
/// </para>
/// <para>
/// PostgreSQL's provider, because the snapshot is PostgreSQL's model; the connection string is never
/// opened — the comparison reads the model and the snapshot, and nothing else.
/// </para>
/// </remarks>
public class ModelSnapshotTests
{
    [Fact]
    public void HasPendingModelChanges_TheModelAsBuilt_IsWhatTheMigrationsCarry()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql("Host=never-opened;Database=none")
            .Options;
        using var db = new ApplicationDbContext(options);

        Assert.False(db.Database.HasPendingModelChanges());
    }
}
