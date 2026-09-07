using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Adds <c>Reviews</c>: one written review per user per game, hung off the entry.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>Purely additive — verify that if it is ever regenerated.</strong> One
    /// <c>CREATE TABLE</c> and four <c>CREATE INDEX</c>, nothing else. Run
    /// <c>dotnet ef migrations script</c> and look for <c>DROP TABLE</c> or
    /// <c>ALTER COLUMN ... TYPE</c>; two migrations in this project have scaffolded a
    /// drop-and-recreate that would have destroyed data (see 0018 and 0019).
    /// </para>
    /// <para>
    /// The same composite foreign key <c>UserGamePlaythroughs</c> uses, against the alternate key
    /// on <c>UserGameEntries (Id, UserId)</c> that <c>AddPlaythroughs</c> added — so a review whose
    /// owner is not its entry's owner is refused by the database. The pointer to a playthrough is
    /// <c>ON DELETE SET NULL</c> on purpose: deleting the record of one run must not take the prose
    /// written about the game with it.
    /// </para>
    /// <para>
    /// <c>IX_Reviews_UserGameEntryId_UserId</c> and <c>IX_Reviews_UserId</c> are EF's own
    /// foreign-key indexes rather than anything this feature asked for. The unique index on
    /// <c>UserGameEntryId</c> alone is the one that states the constraint: one review per entry.
    /// </para>
    /// </remarks>
    public partial class AddReviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Reviews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UserGameEntryId = table.Column<int>(type: "integer", nullable: false),
                    Body = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: false),
                    HasSpoilers = table.Column<bool>(type: "boolean", nullable: false),
                    Visibility = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PlaythroughId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reviews", x => x.Id);
                    table.CheckConstraint("CK_Reviews_Visibility", "\"Visibility\" IN ('public', 'private')");
                    table.ForeignKey(
                        name: "FK_Reviews_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Reviews_UserGameEntries_UserGameEntryId_UserId",
                        columns: x => new { x.UserGameEntryId, x.UserId },
                        principalTable: "UserGameEntries",
                        principalColumns: new[] { "Id", "UserId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Reviews_UserGamePlaythroughs_PlaythroughId",
                        column: x => x.PlaythroughId,
                        principalTable: "UserGamePlaythroughs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_PlaythroughId",
                table: "Reviews",
                column: "PlaythroughId");

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_UserGameEntryId",
                table: "Reviews",
                column: "UserGameEntryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_UserGameEntryId_UserId",
                table: "Reviews",
                columns: new[] { "UserGameEntryId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_UserId",
                table: "Reviews",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Reviews");
        }
    }
}
