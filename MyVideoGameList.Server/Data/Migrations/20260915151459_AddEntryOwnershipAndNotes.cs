using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntryOwnershipAndNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "UserGameEntries",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Ownership",
                table: "UserGameEntries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserGameEntries_Ownership",
                table: "UserGameEntries",
                sql: "\"Ownership\" IS NULL OR \"Ownership\" IN ('owned', 'subscription', 'borrowed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserGameEntries_Ownership",
                table: "UserGameEntries");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "UserGameEntries");

            migrationBuilder.DropColumn(
                name: "Ownership",
                table: "UserGameEntries");
        }
    }
}
