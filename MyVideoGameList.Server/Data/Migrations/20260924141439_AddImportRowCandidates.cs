using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddImportRowCandidates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The empty array is both the backfill for the rows already here and the right answer
            // for them: whether a pass has looked at a row is MatchKind's to say, and every row
            // that already exists says it.
            migrationBuilder.AddColumn<List<int>>(
                name: "Candidates",
                table: "ImportRows",
                type: "integer[]",
                nullable: false,
                defaultValue: new List<int>());

            // And now that every row has a value, the default has no job left to do. EF writes the
            // column on every insert, so leaving it would be a second source of truth for a value
            // that already has one.
            migrationBuilder.Sql("""ALTER TABLE "ImportRows" ALTER COLUMN "Candidates" DROP DEFAULT;""");

            // `unmatched` used to mean both "the file named no game" and "we looked and found
            // none", because nothing could look. Now that something can, the rows carrying the
            // first meaning have to say so, or no matching pass would ever reach them. Exact
            // rather than a guess: before this migration there was no other way for a row with no
            // game to exist.
            migrationBuilder.Sql(
                """
                UPDATE "ImportRows" SET "MatchKind" = 'unlooked'
                WHERE "GameId" IS NULL AND "MatchKind" = 'unmatched';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Candidates",
                table: "ImportRows");
        }
    }
}
