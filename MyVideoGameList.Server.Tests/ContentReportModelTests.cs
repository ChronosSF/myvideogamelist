using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The shape of <c>ContentReports</c> and of a review's <c>HiddenAt</c>, on the model and in the migrations.
/// </summary>
/// <remarks>
/// <para>
/// On the model because the in-memory provider enforces none of it: a second report by one reader, a report
/// about two things or about nothing, and an unknown reason all succeed there. PostgreSQL's refusals are
/// the integration suite's <c>ModerationFlowTests</c>.
/// </para>
/// <para>
/// And in the migrations' snapshot, which fails until a migration carries them. <see cref="ModelSnapshotTests"/>
/// already fails on any difference; this names what this table needs, so a later migration that drops one
/// of its constraints fails here by name rather than as one more pending change. See
/// <c>docs/decisions/0076-*</c>.
/// </para>
/// </remarks>
public class ContentReportModelTests
{
    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql("Host=never-opened;Database=none")
            .Options);

    private static IReadOnlyEntityType Reports(IReadOnlyModel model) =>
        model.FindEntityType(typeof(ContentReport).FullName!)
        ?? throw new Xunit.Sdk.XunitException("No ContentReports in this model.");

    /// <summary>The model as the migrations last left it.</summary>
    private static IReadOnlyModel Snapshot(ApplicationDbContext db) =>
        db.GetService<IMigrationsAssembly>().ModelSnapshot?.Model
        ?? throw new Xunit.Sdk.XunitException("No migrations snapshot.");

    public static TheoryData<string> Models() => ["model", "snapshot"];

    private static IReadOnlyModel Model(ApplicationDbContext db, string which) =>
        which == "model" ? db.GetService<IDesignTimeModel>().Model : Snapshot(db);

    [Theory]
    [MemberData(nameof(Models))]
    public void ContentReport_IsAboutOneThing_AndForAReasonTheTermsName(string which)
    {
        using var db = NewDb();

        var checks = Reports(Model(db, which)).GetCheckConstraints().ToDictionary(c => c.Name!, c => c.Sql);

        Assert.Equal("(\"ReviewId\" IS NULL) <> (\"ProfileUserId\" IS NULL)", checks["CK_ContentReports_OneSubject"]);
        Assert.Equal(
            "\"Reason\" IN ('spam', 'abuse', 'impersonation', 'illegal', 'rights', 'other')",
            checks["CK_ContentReports_Reason"]);
    }

    [Theory]
    [MemberData(nameof(Models))]
    public void ContentReport_IsOnePerReaderOfEachThing(string which)
    {
        // Two partial indexes, because PostgreSQL holds two nulls distinct and one index over both
        // pointers would let a reader report one profile any number of times.
        using var db = NewDb();

        var unique = Reports(Model(db, which)).GetIndexes()
            .Where(index => index.IsUnique)
            .Select(index => (
                string.Join(",", index.Properties.Select(p => p.Name)),
                index[RelationalAnnotationNames.Filter] as string))
            .Order()
            .ToList();

        Assert.Equal(
            [
                ("UserId,ProfileUserId", "\"ProfileUserId\" IS NOT NULL"),
                ("UserId,ReviewId", "\"ReviewId\" IS NOT NULL"),
            ],
            unique);
    }

    [Theory]
    [MemberData(nameof(Models))]
    public void ContentReport_GoesWithItsReader_ItsReview_AndTheAccountItReports(string which)
    {
        using var db = NewDb();

        var cascades = Reports(Model(db, which)).GetForeignKeys()
            .Select(fk => (fk.Properties.Single().Name, fk.DeleteBehavior))
            .Order()
            .ToList();

        Assert.Equal(
            [
                (nameof(ContentReport.ProfileUserId), DeleteBehavior.Cascade),
                (nameof(ContentReport.ReviewId), DeleteBehavior.Cascade),
                (nameof(ContentReport.UserId), DeleteBehavior.Cascade),
            ],
            cascades);
    }

    [Theory]
    [MemberData(nameof(Models))]
    public void Review_HasAMomentItWasHidden(string which)
    {
        using var db = NewDb();

        var reviews = Model(db, which).FindEntityType(typeof(Review).FullName!)!;

        Assert.True(reviews.FindProperty(nameof(Review.HiddenAt))?.IsNullable);
    }

    [Fact]
    public void ContentReport_Note_HoldsWhatTheInputAllows()
    {
        using var db = NewDb();

        Assert.Equal(ContentReport.NoteMaxLength,
            Reports(db.Model).FindProperty(nameof(ContentReport.Note))!.GetMaxLength());
        Assert.All(ReportReason.All, reason => Assert.True(
            reason.Length <= Reports(db.Model).FindProperty(nameof(ContentReport.Reason))!.GetMaxLength()));
    }
}
