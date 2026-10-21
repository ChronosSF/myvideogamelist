using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserGameEntryScoredAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Null on every existing row, and deliberately not backfilled. Nothing recorded when an
            // existing score was given — not the entry's AddedAt, which is when the game was first
            // recorded, and not an event, since a score writes none — so any value put here would be
            // a moment made up for the history to show. Those scores stay out of it (ADR 0062), and
            // every row already satisfies the check below.
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScoredAt",
                table: "UserGameEntries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserGameEntries_ScoredAt_HasScore",
                table: "UserGameEntries",
                sql: "\"ScoredAt\" IS NULL OR \"Score\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserGameEntries_ScoredAt_HasScore",
                table: "UserGameEntries");

            migrationBuilder.DropColumn(
                name: "ScoredAt",
                table: "UserGameEntries");
        }
    }
}
