using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Introduces the seeded status lookup and the append-only status event log, and converts
    /// <c>UserGameLists.ListType</c> from a free string to a foreign key.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The scaffolded version of this migration dropped <c>ListType</c> and added <c>StatusId</c>
    /// with a default of 0 — which discards every existing entry's status and leaves rows pointing
    /// at a status id that does not exist. It has been rewritten to seed the lookup first, map the
    /// three existing values across, and only then drop the old column.
    /// </para>
    /// <para>
    /// The mapping has no <c>ELSE</c> fallback on purpose. Any value outside the three that
    /// <c>ValidListTypes</c> permitted leaves <c>StatusId</c> null and the following
    /// <c>SET NOT NULL</c> fails, which is the correct outcome: unrecognised data should stop the
    /// migration rather than be silently reinterpreted as Backlog.
    /// </para>
    /// </remarks>
    public partial class AddListStatusesAndEventLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- 1. The lookup, seeded, before anything can reference it -------------------
            migrationBuilder.CreateTable(
                name: "ListStatuses",
                columns: table => new
                {
                    Id = table.Column<short>(type: "smallint", nullable: false),
                    Key = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DefaultName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SortOrder = table.Column<short>(type: "smallint", nullable: false),
                    IsStarted = table.Column<bool>(type: "boolean", nullable: false),
                    IsTerminal = table.Column<bool>(type: "boolean", nullable: false),
                    CountsAsCompletion = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ListStatuses", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "ListStatuses",
                columns: new[] { "Id", "CountsAsCompletion", "DefaultName", "IsStarted", "IsTerminal", "Key", "SortOrder" },
                values: new object[,]
                {
                    { (short)1, false, "Backlog", false, false, "backlog", (short)1 },
                    { (short)2, false, "Playing", true, false, "playing", (short)2 },
                    { (short)3, false, "On Hold", true, false, "on_hold", (short)3 },
                    { (short)4, true, "Finished", true, true, "finished", (short)4 },
                    { (short)5, false, "Dropped", true, true, "dropped", (short)5 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_ListStatuses_Key",
                table: "ListStatuses",
                column: "Key",
                unique: true);

            // ---- 2. Carry the existing entries across ------------------------------------
            migrationBuilder.AddColumn<short>(
                name: "StatusId",
                table: "UserGameLists",
                type: "smallint",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "UserGameLists"
                SET "StatusId" = CASE "ListType"
                    WHEN 'backlog'  THEN 1
                    WHEN 'playing'  THEN 2
                    WHEN 'finished' THEN 4
                END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "UserGameLists" ALTER COLUMN "StatusId" SET NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "ListType",
                table: "UserGameLists");

            migrationBuilder.CreateIndex(
                name: "IX_UserGameLists_StatusId",
                table: "UserGameLists",
                column: "StatusId");

            migrationBuilder.AddForeignKey(
                name: "FK_UserGameLists_ListStatuses_StatusId",
                table: "UserGameLists",
                column: "StatusId",
                principalTable: "ListStatuses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // ---- 3. The event log ---------------------------------------------------------
            migrationBuilder.CreateTable(
                name: "UserGameEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    GameId = table.Column<int>(type: "integer", nullable: false),
                    FromStatusId = table.Column<short>(type: "smallint", nullable: true),
                    ToStatusId = table.Column<short>(type: "smallint", nullable: true),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserGameEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserGameEvents_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserGameEvents_ListStatuses_FromStatusId",
                        column: x => x.FromStatusId,
                        principalTable: "ListStatuses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserGameEvents_ListStatuses_ToStatusId",
                        column: x => x.ToStatusId,
                        principalTable: "ListStatuses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEvents_FromStatusId",
                table: "UserGameEvents",
                column: "FromStatusId");

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEvents_GameId_OccurredAt",
                table: "UserGameEvents",
                columns: new[] { "GameId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEvents_ToStatusId_OccurredAt",
                table: "UserGameEvents",
                columns: new[] { "ToStatusId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEvents_UserId_OccurredAt",
                table: "UserGameEvents",
                columns: new[] { "UserId", "OccurredAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserGameEvents");

            migrationBuilder.DropForeignKey(
                name: "FK_UserGameLists_ListStatuses_StatusId",
                table: "UserGameLists");

            migrationBuilder.DropIndex(
                name: "IX_UserGameLists_StatusId",
                table: "UserGameLists");

            // Map back to the three original strings. Games sitting in On Hold or Dropped have no
            // pre-existing equivalent, so they fall back to Backlog — a downgrade cannot be
            // lossless once the taxonomy has grown, and Backlog is the least wrong answer for a
            // game whose progress the old schema could not express.
            migrationBuilder.AddColumn<string>(
                name: "ListType",
                table: "UserGameLists",
                type: "text",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "UserGameLists"
                SET "ListType" = CASE "StatusId"
                    WHEN 2 THEN 'playing'
                    WHEN 4 THEN 'finished'
                    ELSE 'backlog'
                END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "UserGameLists" ALTER COLUMN "ListType" SET NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "StatusId",
                table: "UserGameLists");

            migrationBuilder.DropTable(
                name: "ListStatuses");
        }
    }
}
