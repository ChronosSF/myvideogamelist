using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountLook : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Theme",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "ink",
                oldClrType: typeof(string),
                oldType: "text");

            // Every account said "dark", the one theme there was, or "light" from before that went
            // (ADR 0048). Both are the default palette now, and the check below admits only names.
            migrationBuilder.Sql(
                "UPDATE \"AspNetUsers\" SET \"Theme\" = 'ink' "
                + "WHERE \"Theme\" NOT IN ('ink', 'slate', 'dusk', 'plum', 'graphite', 'custom')");

            migrationBuilder.AddColumn<string>(
                name: "BackgroundPattern",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "honeycomb");

            migrationBuilder.AddColumn<string>(
                name: "PatternTint",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "grey");

            migrationBuilder.AddColumn<string>(
                name: "ThemeAccent",
                table: "AspNetUsers",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThemeBackground",
                table: "AspNetUsers",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers",
                sql: "\"BackgroundPattern\" IN ('honeycomb', 'isometric', 'perspective', 'pixels', 'none')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers",
                sql: "\"PatternTint\" IN ('grey', 'accent')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers",
                sql: "\"Theme\" IN ('ink', 'slate', 'dusk', 'plum', 'graphite', 'custom')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_ThemeColours",
                table: "AspNetUsers",
                sql: "(\"Theme\" = 'custom') = (\"ThemeBackground\" IS NOT NULL AND \"ThemeAccent\" IS NOT NULL) AND (\"ThemeBackground\" IS NULL OR \"ThemeBackground\" ~ '^#[0-9a-f]{6}$') AND (\"ThemeAccent\" IS NULL OR \"ThemeAccent\" ~ '^#[0-9a-f]{6}$')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_Theme",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_ThemeColours",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "BackgroundPattern",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "PatternTint",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "ThemeAccent",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "ThemeBackground",
                table: "AspNetUsers");

            // Before this, every account said "dark".
            migrationBuilder.Sql("UPDATE \"AspNetUsers\" SET \"Theme\" = 'dark'");

            migrationBuilder.AlterColumn<string>(
                name: "Theme",
                table: "AspNetUsers",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldDefaultValue: "ink");
        }
    }
}
