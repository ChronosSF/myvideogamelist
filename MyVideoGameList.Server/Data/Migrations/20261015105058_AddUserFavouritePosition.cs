using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserFavouritePosition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The backlog's position, on the showcase (ADR 0054, ADR 0064), and nullable with no
            // default, no backfill and no index for the reasons that one is. Null is "never placed",
            // true of every favourite that exists today, and a showcase nobody has arranged reads
            // newest first exactly as before. With no default, adding the column changes the catalogue
            // only and rewrites no rows; the check scans the table once and every row passes it.
            //
            // This follows #116's AddUserGameEntryPosition and is regenerated if that one is.
            migrationBuilder.AddColumn<int>(
                name: "Position",
                table: "UserFavourites",
                type: "integer",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_UserFavourites_Position_Range",
                table: "UserFavourites",
                sql: "\"Position\" IS NULL OR (\"Position\" >= -1000000000 AND \"Position\" <= 1000000000)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_UserFavourites_Position_Range",
                table: "UserFavourites");

            migrationBuilder.DropColumn(
                name: "Position",
                table: "UserFavourites");
        }
    }
}
