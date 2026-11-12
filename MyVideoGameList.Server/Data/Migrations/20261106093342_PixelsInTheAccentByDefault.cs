using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class PixelsInTheAccentByDefault : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers");

            migrationBuilder.AlterColumn<string>(
                name: "PatternTint",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "accent",
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldDefaultValue: "grey");

            migrationBuilder.AlterColumn<string>(
                name: "BackgroundPattern",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "pixels",
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldDefaultValue: "honeycomb");

            // Every account but an admin's was given the old default by the column, never by a choice, since
            // nobody else could choose (ADR 0082 §8), so each still holding the old default moves to the new
            // one: otherwise, the day everybody may choose, those accounts would be drawn in a default nobody
            // picked. An admin who had picked the old default moves too, the one choice this cannot tell
            // apart (ADR 0085).
            migrationBuilder.Sql(
                "UPDATE \"AspNetUsers\" SET \"BackgroundPattern\" = 'pixels', \"PatternTint\" = 'accent'"
                + " WHERE \"BackgroundPattern\" = 'honeycomb' AND \"PatternTint\" = 'grey'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers",
                sql: "\"BackgroundPattern\" IN ('pixels', 'honeycomb', 'isometric', 'perspective', 'none')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers",
                sql: "\"PatternTint\" IN ('accent', 'grey')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The rows Up moved stay where they are: by then they cannot be told from an admin's choice, and
            // the release before this one draws them as they are, since it knows both names.
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers");

            migrationBuilder.AlterColumn<string>(
                name: "PatternTint",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "grey",
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldDefaultValue: "accent");

            migrationBuilder.AlterColumn<string>(
                name: "BackgroundPattern",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "honeycomb",
                oldClrType: typeof(string),
                oldType: "character varying(16)",
                oldMaxLength: 16,
                oldDefaultValue: "pixels");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_BackgroundPattern",
                table: "AspNetUsers",
                sql: "\"BackgroundPattern\" IN ('honeycomb', 'isometric', 'perspective', 'pixels', 'none')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_PatternTint",
                table: "AspNetUsers",
                sql: "\"PatternTint\" IN ('grey', 'accent')");
        }
    }
}
