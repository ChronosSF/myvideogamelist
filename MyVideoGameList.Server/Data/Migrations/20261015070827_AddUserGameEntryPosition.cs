using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserGameEntryPosition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Nullable, with no default and no backfill, on purpose. Null is "never placed", which is
            // true of every row that exists today, and a list nobody has arranged reads in the order
            // its games arrived without a number on any of them (ADR 0054). With no default, adding
            // the column changes the catalogue only and rewrites no rows; the check below scans the
            // table once to validate, and every row passes it, being null.
            //
            // No index. The only read is the owner's whole list, which is already fetched by user,
            // and nothing statistical or public asks for a position.
            migrationBuilder.AddColumn<int>(
                name: "Position",
                table: "UserGameEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserGameEntries_Position_Range",
                table: "UserGameEntries",
                sql: "\"Position\" IS NULL OR (\"Position\" >= -1000000000 AND \"Position\" <= 1000000000)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserGameEntries_Position_Range",
                table: "UserGameEntries");

            migrationBuilder.DropColumn(
                name: "Position",
                table: "UserGameEntries");
        }
    }
}
