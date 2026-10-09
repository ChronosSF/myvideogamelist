using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The Grouvee preset, against the shapes a real export actually contains.
/// </summary>
/// <remarks>
/// The fixtures below are small but every one of them is copied from the structure of a genuine
/// 608-row export rather than invented — the <c>"None"</c> strings, the zero seconds and the
/// "Main Story" written onto every shelved game are the three things in that file that turn into
/// plausible wrong answers rather than into errors, so each has a test of its own. The completion
/// levels are the exact strings two real exports carried.
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

    [Theory]
    [InlineData("Main Story", PlaythroughTypeKeys.Normally)]
    [InlineData("Main Story + Extras", PlaythroughTypeKeys.Normally)]
    [InlineData("100% Completion", PlaythroughTypeKeys.Completionist)]
    public void Read_ACompletionLevel_BecomesOurType(string level, string expected)
    {
        // ADR 0049. Grouvee's "Main Story" means the game was finished, not that it was hurried, so
        // it lands with "Main Story + Extras" on normally, and nothing an import writes is rushed.
        var row = Single(Game(
            dates: $$"""[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "{{level}}", "platform": ""}]"""));

        Assert.Equal(expected, Assert.Single(row.Playthroughs).Type);
    }

    [Fact]
    public void Read_NoCompletionLevel_LeavesTheRunUntyped()
    {
        // What Grouvee leaves on a run nobody gave a level — eight of them in a real export.
        var row = Single(Game(
            dates: """[{"date_started": "2025-03-09", "date_finished": "2025-05-03", "seconds_played": 65400, "level_of_completion": null, "platform": ""}]"""));

        var run = Assert.Single(row.Playthroughs);
        Assert.Null(run.Type);
        Assert.Equal(1090, run.MinutesPlayed);
    }

    [Fact]
    public void Read_ACompletionLevelNoExportHasCarried_LeavesTheRunUntypedRatherThanGuessing()
    {
        // "Completionist" is the word a fixture once invented for Grouvee's top level; the real one
        // is "100% Completion". A typed run with minutes feeds the community medians, so a level
        // nobody has seen in a real file costs a type rather than a guess.
        var row = Single(Game(
            dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Completionist", "platform": ""}]"""));

        var run = Assert.Single(row.Playthroughs);
        Assert.Null(run.Type);
        Assert.Equal(375, run.MinutesPlayed);
    }

    [Fact]
    public void Read_ACompletionLevelOnItsOwn_IsNotARun()
    {
        // Every game Grouvee shelves gets a play-log row reading "Main Story" and nothing else — 448
        // of them in a real export. A level is a type for a run, never a reason to make one.
        var row = Single(Game(
            dates: """[{"date_started": "None", "date_finished": "None", "seconds_played": 0, "level_of_completion": "100% Completion", "platform": ""}]"""));

        Assert.Empty(row.Playthroughs);
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
        Assert.False(row.PlayedUnresolved);
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
    public void Read_PlayedWithoutAFinishDate_IsInTheGroupItsOwnerCanAnswerForAtOnce()
    {
        // ADR 0045. No status is still invented for it — the flag is what lets the review screen
        // ask its owner once for every such game, instead of leaving most of a long-time user's
        // library in no list.
        var row = Single(Game());

        Assert.True(row.PlayedUnresolved);
    }

    [Fact]
    public void Read_PlayedAndWishedFor_IsStillUnresolved()
    {
        // The wishlist is an axis rather than a status, so it says nothing about how playing the
        // game ended and must not take the row out of the group.
        var row = Single(Game(
            shelves: """{"Played": {"date_added": "2021-10-02T06:54:47Z"}, "Wish List": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.True(row.PlayedUnresolved);
        Assert.True(row.Wishlist);
        Assert.Null(row.Status);
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

        // No status, but not for want of knowing how it ended: nobody has played it.
        Assert.False(row.PlayedUnresolved);
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
    public void Read_PlayingAndPlayedWithNoFinishDate_IsPlayingAndNotUnresolved()
    {
        // Playing is an answer, so a game being replayed is not in the group the review screen
        // asks about: putting the group in Finished must not take it out of Playing.
        var row = Single(Game(
            shelves: """{"Played": {"date_added": "2021-10-02T06:54:47Z"}, "Playing": {"date_added": "2025-11-28T00:00:00Z"}}"""));

        Assert.Equal(ListStatusKeys.Playing, row.Status);
        Assert.False(row.PlayedUnresolved);
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

        // Asked about row by row, and not swept up in the group's one answer.
        Assert.False(row.PlayedUnresolved);
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

        // Taken off every shelf, which is its owner saying they stopped tracking it — so the
        // answer the review screen takes for unresolved Played games is not applied to it.
        Assert.False(orphan.PlayedUnresolved);
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
    public void Read_ASecondDistinctRunInThePlayLog_IsKeptAlongsideTheFirst()
    {
        // The dedup used to be "does this row already have a playthrough", which threw away every
        // run after the first. The play log does repeat the collection's runs, but a game can
        // genuinely have several — three did in the export this was built from.
        var rows = Source.Read(Document(
            Game(dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Main Story", "platform": ""}]"""),
            """
            , "play_log": [{
                "date_started": "2026-01-10", "date_finished": "2026-01-20", "seconds_played": 7200,
                "level_of_completion": "Main Story", "platform": "",
                "game": {"name": "Metal Gear Solid 3: Snake Eater", "igdb_id": 379}
              }]
            """));

        var row = Assert.Single(rows);
        Assert.Equal(2, row.Playthroughs.Count);
        Assert.Contains(row.Playthroughs, p => p.MinutesPlayed == 375);
        Assert.Contains(row.Playthroughs, p => p.MinutesPlayed == 120);
    }

    [Fact]
    public void Read_TheSourcesOwnRowId_IsKeptForTraceability()
    {
        Assert.Equal("116524", Single(Game()).SourceRef);
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
    public void Read_TheCsvForm_MapsTheCompletionLevelAsTheJsonDoes()
    {
        // The CSV carries the same run as quoted JSON in its `dates` column, doubled quotes and all,
        // and a real one held exactly the levels the JSON did.
        const string csv =
            "id,name,shelves,dates,igdb_id\n"
            + "195642,Split Fiction,\"{\"\"Played\"\": {\"\"date_added\"\": \"\"2025-05-04T05:32:42Z\"\"}}\","
            + "\"[{\"\"date_started\"\": \"\"2025-03-09\"\", \"\"date_finished\"\": \"\"2025-05-03\"\", "
            + "\"\"seconds_played\"\": 65400, \"\"level_of_completion\"\": \"\"100% Completion\"\", \"\"platform\"\": \"\"\"\"}]\","
            + "325594\n";

        var row = Assert.Single(Source.Read(csv));

        Assert.Equal(PlaythroughTypeKeys.Completionist, Assert.Single(row.Playthroughs).Type);
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
