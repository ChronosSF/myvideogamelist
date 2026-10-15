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
            // its games arrived without a number on any of them (ADR 0054). In PostgreSQL this is a
            // change to the catalogue only: no default means no rewrite of the table.
            //
            // No index either. The only read is the owner's whole list, which is already fetched by
            // user, and nothing statistical or public asks for a position.
            migrationBuilder.AddColumn<int>(
                name: "Position",
                table: "UserGameEntries",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Position",
                table: "UserGameEntries");
        }
    }
}
