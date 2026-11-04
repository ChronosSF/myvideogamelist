using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOnyxPalette : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers");

            // A draft of this migration, which never reached master, added the same preset as 'oxblood'. A
            // database that ran it keeps the choice under the preset's name, rather than refusing the check.
            migrationBuilder.Sql("UPDATE \"AspNetUsers\" SET \"Theme\" = 'onyx' WHERE \"Theme\" = 'oxblood'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers",
                sql: "\"Theme\" IN ('ink', 'slate', 'dusk', 'plum', 'graphite', 'onyx', 'custom')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The release before this one has no Onyx, and its check would refuse the row.
            migrationBuilder.Sql("UPDATE \"AspNetUsers\" SET \"Theme\" = 'ink' WHERE \"Theme\" = 'onyx'");

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
