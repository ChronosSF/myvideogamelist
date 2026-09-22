using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The Grouvee preset, against the shapes a real export actually contains.
/// </summary>
/// <remarks>
/// The fixtures below are small but every one of them is copied from the structure of a genuine
/// 608-row export rather than invented — the <c>"None"</c> strings, the zero seconds and the
/// defaulted completion level are the three things in that file that turn into plausible wrong
/// answers rather than into errors, so each has a test of its own.
/// </remarks>
public class GrouveeImportSourceTests
{
    private static readonly GrouveeImportSource Source = new();

    /// <summary>One collection entry, wrapped in the document envelope it arrives in.</summary>
    private static string Document(string collection, string extra = "") =>
        $$"""
          {
            "export_format_version": 2,
            "account": { "favorite_games": [] },
            "collection": [{{collection}}],
            "lists": [], "reviews": [], "play_log": [], "statuses": [], "comments": []
            {{extra}}
          }
          """;

    /// <summary>
    /// A shelved game with nothing else recorded, which is what most of a real export looks like:
    /// Grouvee writes this play-log row whenever a game is shelved.
    /// </summary>
    private static string Game(
        string name = "Metal Gear Solid 3: Snake Eater",
        string shelves = """{"Played": {"date_added": "2021-10-02T06:54:47Z"}}""",
        string rating = "5",
        string dates = """[{"date_started": "None", "date_finished": "None", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]""",
        string igdbId = "379",
        string reviewTitle = "",
        string review = "",
        string platforms = """{"PlayStation 2": {"url": "https://www.grouvee.com/games/platform/55-playstation-2/"}}""") =>
        $$"""
          {
            "id": 116524,
            "name": "{{name}}",
            "shelves": {{shelves}},
            "platforms": {{platforms}},
            "rating": {{rating}},
            "review_title": "{{reviewTitle}}",
            "review": "{{review}}",
            "dates": {{dates}},
            "release_date": "2004-11-17",
            "date_added_to_collection": "2021-10-02",
            "igdb_id": {{igdbId}}
          }
          """;

    private static ImportRowPayload Single(string collection, string extra = "") =>
        Assert.Single(Source.Read(Document(collection, extra)));

    [Fact]
    public void Read_AbsentDates_AreTheStringNoneAndBecomeNull()
    {
        // The trap this preset exists to survive: their exporter leaks Python's str(None), so an
        // absent date is a non-empty value that is not a date.
        var row = Single(Game());

        Assert.Empty(row.Playthroughs);
    }

    [Fact]
    public void Read_ZeroSecondsPlayed_IsNotADuration()
    {
        // Zero is "not recorded". A zero-minute run would fail the column's check constraint and
        // would be a claim nobody made.
        var row = Single(Game(
            dates: """[{"date_started": "2024-04-25", "date_finished": "None", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]"""));

        Assert.Null(Assert.Single(row.Playthroughs).MinutesPlayed);
    }

    [Fact]
    public void Read_SecondsPlayed_BecomeWholeMinutes()
    {
        var row = Single(Game(
            dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Main Story", "platform": ""}]"""));

        var run = Assert.Single(row.Playthroughs);
        Assert.Equal(375, run.MinutesPlayed);
        Assert.Equal(new DateOnly(2024, 4, 25), run.StartedOn);
        Assert.Equal(new DateOnly(2024, 4, 28), run.FinishedOn);
    }

    [Fact]
    public void Read_APlaythrough_CarriesNoType()
    {
        // The whole of ADR 0037 decision 4, asserted where it would be undone: the source field
        // says "Main Story" and must not reach a type, because a typed run with a duration feeds
        // the community medians and that label is a default rather than the user's answer.
        var row = Single(Game(
            dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Completionist", "platform": ""}]"""));

        // There is no type on the payload at all, which is what makes this structural rather than
        // a rule somebody has to remember. The assertion is that the run survives without one.
        Assert.Single(row.Playthroughs);
        Assert.Equal(375, row.Playthroughs[0].MinutesPlayed);
    }

    [Fact]
    public void Read_PlayedWithAFinishDate_IsFinished()
    {
        // A user-entered finish date is a statement that the game was finished — the signal a
        // platform import does not have (ADR 0037 decision 3).
        var row = Single(Game(
            dates: """[{"date_started": "None", "date_finished": "2022-09-23", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]"""));

        Assert.Equal(ListStatusKeys.Finished, row.Status);
        Assert.False(row.StatusUnrecognised);
    }

    [Fact]
    public void Read_PlayedWithoutAFinishDate_HasNoStatus()
    {
        // 0026's ambiguous bucket, and 448 of the 608 rows in the export this was built from.
        // Played means "I have played this" and nothing more; guessing is what 0026 refuses.
        var row = Single(Game());

        Assert.Null(row.Status);
        Assert.False(row.StatusUnrecognised);
        Assert.Equal("Played", row.SourceStatus);
    }

    [Fact]
    public void Read_PlayingShelf_IsPlaying()
    {
        var row = Single(Game(shelves: """{"Playing": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.Equal(ListStatusKeys.Playing, row.Status);
    }

    [Fact]
    public void Read_BacklogShelf_IsBacklog()
    {
        var row = Single(Game(shelves: """{"Backlog": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.Equal(ListStatusKeys.Backlog, row.Status);
    }

    [Fact]
    public void Read_WishListShelf_SetsTheAxisAndNoStatus()
    {
        // The wishlist is an axis, not a sixth status (ADR 0022), so wanting a game says nothing
        // about which list it is in.
        var row = Single(Game(shelves: """{"Wish List": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.True(row.Wishlist);
        Assert.Null(row.Status);
        Assert.False(row.StatusUnrecognised);
    }

    [Fact]
    public void Read_WishListAlongsideAStatusShelf_KeepsBoth()
    {
        var row = Single(Game(
            shelves: """{"Backlog": {"date_added": "2025-11-28T00:00:00Z"}, "Wish List": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.Equal(ListStatusKeys.Backlog, row.Status);
        Assert.True(row.Wishlist);
    }

    [Fact]
    public void Read_PlayingBeatsPlayed_WhenAGameIsOnBoth()
    {
        // Current state is the truer answer about now: a game on both is one being replayed.
        var row = Single(Game(
            shelves: """{"Played": {"date_added": "2021-10-02T06:54:47Z"}, "Playing": {"date_added": "2025-11-28T00:00:00Z"}}""",
            dates: """[{"date_started": "None", "date_finished": "2022-09-23", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]"""));

        Assert.Equal(ListStatusKeys.Playing, row.Status);
    }

    [Fact]
    public void Read_ACustomShelf_IsFlaggedRatherThanDefaulted()
    {
        // The rule from the spec §3.2: an unrecognised status is surfaced for the user to resolve,
        // never silently dropped and never silently defaulted to Backlog.
        var row = Single(Game(shelves: """{"Abandoned Forever": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.Null(row.Status);
        Assert.True(row.StatusUnrecognised);
        Assert.Equal("Abandoned Forever", row.SourceStatus);
    }

    [Fact]
    public void Read_FiveStarRating_BecomesTenOutOfTen()
    {
        Assert.Equal((short)10, Single(Game(rating: "5")).Score);
        Assert.Equal((short)6, Single(Game(rating: "3")).Score);
        Assert.Equal((short)2, Single(Game(rating: "1")).Score);
        Assert.Equal((short)7, Single(Game(rating: "3.5")).Score);
    }

    [Fact]
    public void Read_NoRating_IsNoScore()
    {
        Assert.Null(Single(Game(rating: "null")).Score);
    }

    [Fact]
    public void Read_TheIgdbId_IsCarriedThrough()
    {
        // The finding the whole preset turns on: Grouvee stores IGDB's id, so no matching is
        // needed on this path (ADR 0037 decision 2).
        Assert.Equal(379, Single(Game()).GameId);
        Assert.Null(Single(Game(igdbId: "null")).GameId);
    }

    [Fact]
    public void Read_DateAddedToCollection_BecomesTheEntrysAddedAt()
    {
        // Otherwise an imported library lands at the top of "recently added" all at once and
        // buries everything the user actually touched.
        Assert.Equal(
            new DateTimeOffset(2021, 10, 2, 0, 0, 0, TimeSpan.Zero),
            Single(Game()).AddedAt);
    }

    [Fact]
    public void Read_AGameOnlyInThePlayLog_IsImportedWithNoStatus()
    {
        // The real export carried 8 of these — played, then unshelved, with the history kept.
        // They are a game the user has data about and is not tracking, which is a real state.
        var rows = Source.Read(Document(
            Game(),
            """
            , "play_log": [{
                "date_started": "2021-07-25", "date_finished": "2021-07-30", "seconds_played": 7200,
                "level_of_completion": "Main Story", "platform": "",
                "game": {"name": "Lotus III: The Ultimate Challenge", "igdb_id": 12672}
              }]
            """));

        var orphan = Assert.Single(rows, r => r.GameId == 12672);
        Assert.Null(orphan.Status);
        Assert.False(orphan.StatusUnrecognised);
        Assert.Equal(120, Assert.Single(orphan.Playthroughs).MinutesPlayed);
    }

    [Fact]
    public void Read_APlayLogRowForAGameAlreadyInTheCollection_IsNotADuplicate()
    {
        var rows = Source.Read(Document(
            Game(dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Main Story", "platform": ""}]"""),
            """
            , "play_log": [{
                "date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500,
                "level_of_completion": "Main Story", "platform": "",
                "game": {"name": "Metal Gear Solid 3: Snake Eater", "igdb_id": 379}
              }]
            """));

        Assert.Single(rows);
        Assert.Single(rows[0].Playthroughs);
    }

    [Fact]
    public void Read_AReviewForAGameNotInTheCollection_CarriesItsScore()
    {
        var rows = Source.Read(Document(
            Game(),
            """
            , "reviews": [{
                "game": {"name": "Another Game", "igdb_id": 1307},
                "title": "", "rating": 4, "text": "Still think about it.", "platform": ""
              }]
            """));

        var orphan = Assert.Single(rows, r => r.GameId == 1307);
        Assert.Equal((short)8, orphan.Score);
        Assert.Equal("Still think about it.", orphan.Notes);
    }

    [Fact]
    public void Read_ReviewText_LandsOnTheNotesAndNotOnAReview()
    {
        // Publishing somebody's prose is not a default worth having (ADR 0037). The payload has
        // nowhere to put a Review, which is what makes that structural.
        var row = Single(Game(reviewTitle: "A long time coming", review: "Worth the wait."));

        Assert.Equal("A long time coming\n\nWorth the wait.", row.Notes);
    }

    [Fact]
    public void Read_AFutureFormatVersion_IsRefusedRatherThanGuessedAt()
    {
        // A renamed field would deserialise to null and import a library with its scores and dates
        // quietly missing — the silent-empty failure class this project has been caught by before.
        var document = Document(Game()).Replace("\"export_format_version\": 2", "\"export_format_version\": 3");

        var error = Assert.Throws<ImportParseException>(() => Source.Read(document));
        Assert.Contains("format 3", error.Message);
    }

    [Fact]
    public void Read_AFileThatIsNotAGrouveeExport_SaysSo()
    {
        Assert.Throws<ImportParseException>(() => Source.Read("""{"something": "else"}"""));
        Assert.Throws<ImportParseException>(() => Source.Read("not json at all"));
    }

    [Fact]
    public void CanRead_RecognisesTheExportByItsContentOrItsName()
    {
        Assert.True(Source.CanRead("export.json", """{"site": "https://www.grouvee.com"""));
        Assert.True(Source.CanRead("collection.csv", "id,name,shelves,date_added_to_collection"));
        Assert.True(Source.CanRead("grouvee_export.json", "{}"));
        Assert.False(Source.CanRead("games.csv", "title,platform,status"));
    }
}
