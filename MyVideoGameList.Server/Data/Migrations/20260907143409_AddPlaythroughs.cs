using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Adds <c>PlaythroughTypes</c> (seeded with the three tiers) and <c>UserGamePlaythroughs</c>,
    /// plus the alternate key on <c>UserGameEntries (Id, UserId)</c> that the latter points at.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>Purely additive — verify that if it is ever regenerated.</strong> Two migrations in
    /// this project have scaffolded a drop-and-recreate that would have destroyed data (see 0018
    /// and 0019). Run <c>dotnet ef migrations script</c> for this migration and look for
    /// <c>DROP TABLE</c>, <c>ALTER COLUMN ... TYPE</c> or a dropped primary key: there should be
    /// none. Every statement here is <c>CREATE TABLE</c>, <c>INSERT</c>, <c>CREATE INDEX</c> or
    /// <c>ADD CONSTRAINT</c>.
    /// </para>
    /// <para>
    /// The alternate key is what makes the composite foreign key possible: a playthrough
    /// references <c>(UserGameEntryId, UserId)</c>, so the database itself refuses a row whose
    /// owner is not the entry's owner. It adds a unique constraint over a pair that the primary
    /// key already made unique, so it relaxes and constrains nothing on the existing rows.
    /// </para>
    /// <para>
    /// The three seeded ids are constants referenced by every playthrough row and must not be
    /// renumbered. Their keys are permanent for the reason <c>ListStatuses</c>' are.
    /// </para>
    /// </remarks>
    public partial class AddPlaythroughs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_UserGameEntries_Id_UserId",
                table: "UserGameEntries",
                columns: new[] { "Id", "UserId" });

            migrationBuilder.CreateTable(
                name: "PlaythroughTypes",
                columns: table => new
                {
                    Id = table.Column<short>(type: "smallint", nullable: false),
                    Key = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DefaultName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SortOrder = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlaythroughTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserGamePlaythroughs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UserGameEntryId = table.Column<int>(type: "integer", nullable: false),
                    TypeId = table.Column<short>(type: "smallint", nullable: true),
                    PlatformId = table.Column<int>(type: "integer", nullable: true),
                    MinutesPlayed = table.Column<int>(type: "integer", nullable: true),
                    StartedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    FinishedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserGamePlaythroughs", x => x.Id);
                    table.CheckConstraint("CK_UserGamePlaythroughs_Dates_Order", "\"StartedOn\" IS NULL OR \"FinishedOn\" IS NULL OR \"FinishedOn\" >= \"StartedOn\"");
                    table.CheckConstraint("CK_UserGamePlaythroughs_MinutesPlayed_Range", "\"MinutesPlayed\" IS NULL OR (\"MinutesPlayed\" >= 1 AND \"MinutesPlayed\" <= 600000)");
                    table.ForeignKey(
                        name: "FK_UserGamePlaythroughs_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserGamePlaythroughs_PlaythroughTypes_TypeId",
                        column: x => x.TypeId,
                        principalTable: "PlaythroughTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserGamePlaythroughs_UserGameEntries_UserGameEntryId_UserId",
                        columns: x => new { x.UserGameEntryId, x.UserId },
                        principalTable: "UserGameEntries",
                        principalColumns: new[] { "Id", "UserId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "PlaythroughTypes",
                columns: new[] { "Id", "DefaultName", "Key", "SortOrder" },
                values: new object[,]
                {
                    { (short)1, "Rushed", "rushed", (short)1 },
                    { (short)2, "Normally", "normally", (short)2 },
                    { (short)3, "Completionist", "completionist", (short)3 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlaythroughTypes_Key",
                table: "PlaythroughTypes",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserGamePlaythroughs_TypeId",
                table: "UserGamePlaythroughs",
                column: "TypeId");

            migrationBuilder.CreateIndex(
                name: "IX_UserGamePlaythroughs_UserGameEntryId_UserId",
                table: "UserGamePlaythroughs",
                columns: new[] { "UserGameEntryId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGamePlaythroughs_UserId_UserGameEntryId",
                table: "UserGamePlaythroughs",
                columns: new[] { "UserId", "UserGameEntryId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserGamePlaythroughs");

            migrationBuilder.DropTable(
                name: "PlaythroughTypes");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_UserGameEntries_Id_UserId",
                table: "UserGameEntries");
        }
    }
}
