using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOxbloodPalette : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers",
                sql: "\"Theme\" IN ('ink', 'slate', 'dusk', 'plum', 'graphite', 'oxblood', 'custom')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The release before this one has no Oxblood, and its check would refuse the row.
            migrationBuilder.Sql("UPDATE \"AspNetUsers\" SET \"Theme\" = 'ink' WHERE \"Theme\" = 'oxblood'");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers",
                sql: "\"Theme\" IN ('ink', 'slate', 'dusk', 'plum', 'graphite', 'custom')");
        }
    }
}
