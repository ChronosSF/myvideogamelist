using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Our own export read back as an import: what the canonical row carries comes back, what it has no
/// field for stays behind, and a value the database would refuse costs that value and nothing more.
/// </summary>
/// <remarks>
/// The documents here are written by hand, as an edited file would be. That the exporter's own
/// output reads the same is <c>ExportRoundTripTests</c>'s job.
/// </remarks>
public class MyVideoGameListImportSourceTests
{
    private static readonly MyVideoGameListImportSource Source = new();

    /// <summary>A document with the sections the reader reads, each given as JSON array items.</summary>
    private static string Export(
        string entries = "",
        string playthroughs = "",
        string reviews = "",
        string wishlist = "",
        string favourites = "") =>
        $$"""
          {
            "exportedAt": "2026-11-04T10:00:00+00:00",
            "account": { "email": "someone@test.local", "userName": "someone", "bio": null },
            "entries": [{{entries}}],
            "events": [{ "gameId": 1, "fromStatus": null, "toStatus": "finished", "occurredAt": "2024-01-01T00:00:00+00:00" }],
            "playthroughs": [{{playthroughs}}],
            "reviews": [{{reviews}}],
            "tags": [{ "name": "cosy", "createdAt": "2024-01-01T00:00:00+00:00" }],
            "entryTags": [],
            "wishlist": [{{wishlist}}],
            "favourites": [{{favourites}}],
            "listSortPreferences": [],
            "listNames": [{ "status": "backlog", "displayName": "Pile of shame" }],
            "importJobs": [],
            "importRows": []
          }
          """;

    private static string Entry(
        int gameId = 1,
        string status = "\"finished\"",
        string score = "8",
        string notes = "\"Loved it\"",
        string addedAt = "\"2024-01-02T03:04:05+00:00\"") =>
        $$"""
          {
            "gameId": {{gameId}}, "status": {{status}}, "score": {{score}}, "scoredAt": "2024-02-01T00:00:00+00:00",
            "ownership": "physical", "notes": {{notes}}, "origin": "manual", "addedAt": {{addedAt}},
            "statusChangedAt": "2024-02-01T00:00:00+00:00", "position": 3
          }
          """;

    private static string Run(
        int gameId = 1,
        string type = "\"completionist\"",
        string minutes = "1200",
        string startedOn = "\"2024-01-05\"",
        string finishedOn = "\"2024-02-01\"",
        string platformId = "48") =>
        $$"""
          {
            "gameId": {{gameId}}, "type": {{type}}, "platformId": {{platformId}}, "minutesPlayed": {{minutes}},
            "startedOn": {{startedOn}}, "finishedOn": {{finishedOn}}, "notes": "Every trophy",
            "createdAt": "2024-02-01T00:00:00+00:00", "updatedAt": "2024-02-01T00:00:00+00:00"
          }
          """;

    private static string Review(int gameId = 1, string body = "A masterpiece.") =>
        $$"""
          {
            "gameId": {{gameId}}, "body": "{{body}}", "hasSpoilers": true, "visibility": "public",
            "createdAt": "2024-02-02T00:00:00+00:00", "updatedAt": "2024-02-02T00:00:00+00:00"
          }
          """;

    private static string Axis(int gameId, string addedAt, string position = "") =>
        $$"""{ "gameId": {{gameId}}, "addedAt": "{{addedAt}}"{{(position.Length > 0 ? $", \"position\": {position}" : "")}} }""";

    // ---------------------------------------------------------------- recognising the file

    [Fact]
    public void CanRead_TheHeadOfOurExport_IsTrue()
    {
        Assert.True(Source.CanRead("anything.json", Export().AsSpan()));
    }

    [Fact]
    public void CanRead_AGrouveeExport_IsFalse()
    {
        const string grouvee = """{ "export_format_version": 2, "account": {}, "collection": [] }""";

        Assert.False(Source.CanRead("myvideogamelist-export.json", grouvee.AsSpan()));
    }

    [Fact]
    public void Read_NotJson_IsRefusedAsAFileWeCannotRead()
    {
        var refused = Assert.Throws<ImportParseException>(() => Source.Read("{ \"exportedAt\": "));

        Assert.Contains("MyVideoGameList export", refused.Message);
    }

    [Fact]
    public void Read_ADocumentWithNoEntriesSection_IsRefusedRatherThanReadAsEmpty()
    {
        // Every export carries every section, so a missing one is a different file, not an empty
        // library — which would otherwise be refused as "no games" and send somebody looking there.
        const string document = """{ "exportedAt": "2026-11-04T10:00:00+00:00", "account": {} }""";

        var refused = Assert.Throws<ImportParseException>(() => Source.Read(document));

        Assert.Equal("That file does not look like a MyVideoGameList export.", refused.Message);
    }

    // ---------------------------------------------------------------- what comes back

    [Fact]
    public void Read_AnEntry_CarriesItsListScoreNotesAndDateByIdWithNoTitle()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry())));

        Assert.Equal(1, row.GameId);
        Assert.Equal(ListStatusKeys.Finished, row.Status);
        Assert.Equal("finished", row.SourceStatus);
        Assert.False(row.StatusUnrecognised);
        Assert.False(row.PlayedUnresolved);
        Assert.Equal((short)8, row.Score);
        Assert.Equal("Loved it", row.Notes);
        Assert.Equal(new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.Zero), row.AddedAt);

        // Named at upload from the cache, since the export carries no titles (ADR 0024).
        Assert.Equal(string.Empty, row.Title);
        Assert.Null(row.ReleaseYear);
    }

    [Fact]
    public void Read_AGameInNoList_IsARowWithNoStatusAndNothingToAsk()
    {
        // ADR 0019's real state, not an unrecognised one: the file says "in no list", and so does
        // the row.
        var row = Assert.Single(Source.Read(Export(entries: Entry(status: "null"))));

        Assert.Null(row.Status);
        Assert.Null(row.SourceStatus);
        Assert.False(row.StatusUnrecognised);
    }

    [Fact]
    public void Read_AStatusWeDoNotKnow_IsAskedAboutRatherThanGuessed()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry(status: "\"replaying\""))));

        Assert.Null(row.Status);
        Assert.Equal("replaying", row.SourceStatus);
        Assert.True(row.StatusUnrecognised);
    }

    [Fact]
    public void Read_AReview_ComesBackAfterTheNotesAndNeverAsAReview()
    {
        // ADR 0037: an import puts prose in the private notes, whoever wrote it first.
        var row = Assert.Single(Source.Read(Export(entries: Entry(), reviews: Review())));

        Assert.Equal("Loved it\n\nA masterpiece.", row.Notes);
    }

    [Fact]
    public void Read_AReviewWithNoNotes_IsTheWholeNote()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry(notes: "null"), reviews: Review())));

        Assert.Equal("A masterpiece.", row.Notes);
    }

    [Fact]
    public void Read_ARun_CarriesItsDatesMinutesTypeAndPlatformId()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry(), playthroughs: Run())));

        var run = Assert.Single(row.Playthroughs);
        Assert.Equal(new DateOnly(2024, 1, 5), run.StartedOn);
        Assert.Equal(new DateOnly(2024, 2, 1), run.FinishedOn);
        Assert.Equal(1200, run.MinutesPlayed);
        Assert.Equal(PlaythroughTypeKeys.Completionist, run.Type);

        // By the id the export holds, which the commit prefers to finding a name in the game's
        // platforms — there is no name to find.
        Assert.Equal(48, run.PlatformId);
        Assert.Null(run.PlatformName);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData("null")]
    public void Read_APlatformIdThatNamesNothing_LeavesTheRunWithoutOne(string platformId)
    {
        // A run logged by hand is held to a positive id and nothing more (PlaythroughInputDto), and
        // so is one read from a file.
        var run = Assert.Single(Assert.Single(Source.Read(Export(
            entries: Entry(), playthroughs: Run(platformId: platformId)))).Playthroughs);

        Assert.Null(run.PlatformId);
        Assert.Equal(1200, run.MinutesPlayed);
    }

    [Fact]
    public void Read_TheWishlistAndFavourites_MarkTheGameTheyName()
    {
        var row = Assert.Single(Source.Read(Export(
            entries: Entry(),
            wishlist: Axis(1, "2023-01-01T00:00:00+00:00"),
            favourites: Axis(1, "2023-06-01T00:00:00+00:00", position: "1"))));

        Assert.True(row.Wishlist);
        Assert.True(row.Favourite);

        // One date per row, and the entry's wins: the commit gives it to the entry and both axes.
        Assert.Equal(new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.Zero), row.AddedAt);
    }

    [Fact]
    public void Read_AGameOnlyOnTheWishlistAndShowcase_IsARowInNoListFromTheEarlierMark()
    {
        var rows = Source.Read(Export(
            entries: Entry(gameId: 1),
            wishlist: Axis(2, "2023-06-01T00:00:00+00:00"),
            favourites: Axis(2, "2023-01-01T00:00:00+00:00")));

        Assert.Equal(new int?[] { 1, 2 }, rows.Select(r => r.GameId));

        var wanted = rows[1];
        Assert.Null(wanted.Status);
        Assert.False(wanted.StatusUnrecognised);
        Assert.True(wanted.Wishlist);
        Assert.True(wanted.Favourite);
        Assert.Equal(new DateTimeOffset(2023, 1, 1, 0, 0, 0, TimeSpan.Zero), wanted.AddedAt);
    }

    [Fact]
    public void Read_ARunForAGameWithNoEntry_IsARowOfItsOwn()
    {
        // Not something the exporter writes, since a run hangs off an entry, but an edited file can
        // say it — and a run somebody recorded is not dropped for want of a list.
        var row = Assert.Single(Source.Read(Export(playthroughs: Run(gameId: 7))));

        Assert.Equal(7, row.GameId);
        Assert.Null(row.Status);
        Assert.Single(row.Playthroughs);
    }

    [Fact]
    public void Read_OnlyTheSectionsTheRowCarries_AreRead()
    {
        // The events, the tags and the list names in the document are all there to be read, and the
        // row has no field for any of them. The reader takes what it carries and leaves the rest.
        var rows = Source.Read(Export(entries: Entry()));

        Assert.Equal(new int?[] { 1 }, rows.Select(r => r.GameId));
    }

    // ---------------------------------------------------------------- what the database would refuse

    [Fact]
    public void Read_AScoreOutOfRange_IsDroppedAndTheRowKept()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry(score: "11"))));

        Assert.Null(row.Score);
        Assert.Equal(ListStatusKeys.Finished, row.Status);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("600001")]
    public void Read_ADurationTheColumnRefuses_IsDroppedAndTheRunKept(string minutes)
    {
        var run = Assert.Single(Assert.Single(Source.Read(Export(
            entries: Entry(), playthroughs: Run(minutes: minutes)))).Playthroughs);

        Assert.Null(run.MinutesPlayed);
        Assert.Equal(new DateOnly(2024, 2, 1), run.FinishedOn);
    }

    [Fact]
    public void Read_ARunFinishedBeforeItStarted_LosesItsStart()
    {
        var run = Assert.Single(Assert.Single(Source.Read(Export(
            entries: Entry(), playthroughs: Run(startedOn: "\"2024-03-01\"", finishedOn: "\"2024-02-01\"")))).Playthroughs);

        Assert.Null(run.StartedOn);
        Assert.Equal(new DateOnly(2024, 2, 1), run.FinishedOn);
    }

    [Fact]
    public void Read_ARunTypeWeDoNotKnow_IsUntyped()
    {
        // A typed run with minutes feeds the community medians (ADR 0016), so an unknown type is
        // left off rather than guessed into one.
        var run = Assert.Single(Assert.Single(Source.Read(Export(
            entries: Entry(), playthroughs: Run(type: "\"speedrun\"")))).Playthroughs);

        Assert.Null(run.Type);
    }

    [Fact]
    public void Read_AGameNamedTwiceOrNamedAsNothing_IsOneRowOrNone()
    {
        var rows = Source.Read(Export(entries: $"{Entry(gameId: 5)}, {Entry(gameId: 5, score: "2")}, {Entry(gameId: 0)}, null"));

        var row = Assert.Single(rows);
        Assert.Equal(5, row.GameId);
        Assert.Equal((short)8, row.Score);
    }

    [Fact]
    public void Read_AnEntryWithNoAddedAt_HasNoDateRatherThanTheYearOne()
    {
        var row = Assert.Single(Source.Read(Export(entries: Entry().Replace("\"addedAt\": \"2024-01-02T03:04:05+00:00\",", ""))));

        Assert.Null(row.AddedAt);
    }
}
