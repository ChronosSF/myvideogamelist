using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Turns the list-membership table into the user's record of a game: renames it to
    /// <c>UserGameEntries</c>, makes the status nullable so a game can leave every list without the
    /// row going with it, and adds the score and the two timestamps a sortable list view needs.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The scaffolded version dropped and recreated the table, which loses every entry — EF cannot
    /// tell a rename from a delete-and-add. Rewritten to rename the table and its constraints in
    /// place.
    /// </para>
    /// <para>
    /// <c>AddedAt</c> is not nullable and existing rows have no stored value, so it is backfilled
    /// from <c>UserGameEvents</c>: the earliest recorded event for a (user, game) is when that game
    /// was added. Rows older than the event log fall back to the migration's own clock, which is
    /// the closest honest answer available. <c>StatusChangedAt</c> comes from the latest event and
    /// stays null when there is none.
    /// </para>
    /// </remarks>
    public partial class AddScoreAndEntryTimestamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- 1. Rename in place, constraints included -------------------------------
            migrationBuilder.RenameTable(
                name: "UserGameLists",
                newName: "UserGameEntries");

            // PostgreSQL keeps the old constraint names through a table rename, and the model
            // snapshot expects the new ones, so each is renamed explicitly.
            migrationBuilder.Sql("""
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "PK_UserGameLists" TO "PK_UserGameEntries";
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "FK_UserGameLists_AspNetUsers_UserId" TO "FK_UserGameEntries_AspNetUsers_UserId";
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "FK_UserGameLists_ListStatuses_StatusId" TO "FK_UserGameEntries_ListStatuses_StatusId";
                ALTER INDEX "IX_UserGameLists_StatusId" RENAME TO "IX_UserGameEntries_StatusId";
                """);

            // ---- 2. A game can now be in no list without losing its entry ----------------
            migrationBuilder.AlterColumn<short>(
                name: "StatusId",
                table: "UserGameEntries",
                type: "smallint",
                nullable: true,
                oldClrType: typeof(short),
                oldType: "smallint");

            // ---- 3. The user's own score, independent of any list -------------------------
            migrationBuilder.AddColumn<short>(
                name: "Score",
                table: "UserGameEntries",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserGameEntries_Score_Range",
                table: "UserGameEntries",
                sql: "\"Score\" IS NULL OR (\"Score\" >= 1 AND \"Score\" <= 10)");

            // ---- 4. Sort keys, backfilled from the event log ------------------------------
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AddedAt",
                table: "UserGameEntries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "StatusChangedAt",
                table: "UserGameEntries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "UserGameEntries" e
                SET "AddedAt" = COALESCE(
                        (SELECT MIN(ev."OccurredAt")
                         FROM "UserGameEvents" ev
                         WHERE ev."UserId" = e."UserId" AND ev."GameId" = e."GameId"),
                        now()),
                    "StatusChangedAt" = (
                        SELECT MAX(ev."OccurredAt")
                        FROM "UserGameEvents" ev
                        WHERE ev."UserId" = e."UserId" AND ev."GameId" = e."GameId");
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "UserGameEntries" ALTER COLUMN "AddedAt" SET NOT NULL;
                """);

            // ---- 5. Indexes for the two default sort orders ------------------------------
            migrationBuilder.CreateIndex(
                name: "IX_UserGameEntries_UserId_AddedAt",
                table: "UserGameEntries",
                columns: new[] { "UserId", "AddedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEntries_UserId_StatusChangedAt",
                table: "UserGameEntries",
                columns: new[] { "UserId", "StatusChangedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserGameEntries_UserId_StatusChangedAt",
                table: "UserGameEntries");

            migrationBuilder.DropIndex(
                name: "IX_UserGameEntries_UserId_AddedAt",
                table: "UserGameEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_UserGameEntries_Score_Range",
                table: "UserGameEntries");

            migrationBuilder.DropColumn(name: "StatusChangedAt", table: "UserGameEntries");
            migrationBuilder.DropColumn(name: "AddedAt", table: "UserGameEntries");
            migrationBuilder.DropColumn(name: "Score", table: "UserGameEntries");

            // Statusless entries cannot exist in the old shape at all. They are games the user
            // scored without listing, so the honest downgrade is to drop those rows rather than
            // invent a status for them.
            migrationBuilder.Sql("""
                DELETE FROM "UserGameEntries" WHERE "StatusId" IS NULL;
                """);

            migrationBuilder.AlterColumn<short>(
                name: "StatusId",
                table: "UserGameEntries",
                type: "smallint",
                nullable: false,
                defaultValue: (short)0,
                oldClrType: typeof(short),
                oldType: "smallint",
                oldNullable: true);

            migrationBuilder.Sql("""
                ALTER INDEX "IX_UserGameEntries_StatusId" RENAME TO "IX_UserGameLists_StatusId";
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "FK_UserGameEntries_ListStatuses_StatusId" TO "FK_UserGameLists_ListStatuses_StatusId";
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "FK_UserGameEntries_AspNetUsers_UserId" TO "FK_UserGameLists_AspNetUsers_UserId";
                ALTER TABLE "UserGameEntries" RENAME CONSTRAINT "PK_UserGameEntries" TO "PK_UserGameLists";
                """);

            migrationBuilder.RenameTable(
                name: "UserGameEntries",
                newName: "UserGameLists");
        }
    }
}
