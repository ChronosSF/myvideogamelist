using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReleaseCalendarCurationConstraints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ShowcaseNames_Prefix",
                table: "ShowcaseNames");

            migrationBuilder.AddColumn<string>(
                name: "NormalizedPrefix",
                table: "ShowcaseNames",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            // Names already on the list get theirs before the index goes on, or all of them would be ""
            // and the second would collide. upper() rather than ToUpperInvariant, which the application
            // writes with: the two agree on ASCII, which showcase names are written in, and this only
            // ever runs over the few names added before it.
            migrationBuilder.Sql("UPDATE \"ShowcaseNames\" SET \"NormalizedPrefix\" = upper(\"Prefix\");");

            migrationBuilder.CreateIndex(
                name: "IX_ShowcaseNames_NormalizedPrefix",
                table: "ShowcaseNames",
                column: "NormalizedPrefix",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_CuratedEvents_Store",
                table: "CuratedEvents",
                sql: "\"Store\" IS NULL OR \"Store\" IN ('steam', 'epic', 'playstation', 'xbox', 'nintendo', 'gog')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ShowcaseNames_NormalizedPrefix",
                table: "ShowcaseNames");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CuratedEvents_Store",
                table: "CuratedEvents");

            migrationBuilder.DropColumn(
                name: "NormalizedPrefix",
                table: "ShowcaseNames");

            migrationBuilder.CreateIndex(
                name: "IX_ShowcaseNames_Prefix",
                table: "ShowcaseNames",
                column: "Prefix",
                unique: true);
        }
    }
}
