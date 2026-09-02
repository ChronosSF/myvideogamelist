using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddListViewPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // "tiles", not "": the scaffolder defaults a non-nullable string to empty, which would
            // leave every existing account with a view mode no client recognises.
            migrationBuilder.AddColumn<string>(
                name: "ListView",
                table: "AspNetUsers",
                type: "text",
                nullable: false,
                defaultValue: "tiles");

            migrationBuilder.CreateTable(
                name: "UserListSortPreferences",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    StatusId = table.Column<short>(type: "smallint", nullable: false),
                    SortKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Descending = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserListSortPreferences", x => new { x.UserId, x.StatusId });
                    table.ForeignKey(
                        name: "FK_UserListSortPreferences_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserListSortPreferences_ListStatuses_StatusId",
                        column: x => x.StatusId,
                        principalTable: "ListStatuses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserListSortPreferences_StatusId",
                table: "UserListSortPreferences",
                column: "StatusId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserListSortPreferences");

            migrationBuilder.DropColumn(
                name: "ListView",
                table: "AspNetUsers");
        }
    }
}
