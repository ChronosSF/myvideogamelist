using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddListNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserListSettings",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    StatusId = table.Column<short>(type: "smallint", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserListSettings", x => new { x.UserId, x.StatusId });
                    table.ForeignKey(
                        name: "FK_UserListSettings_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserListSettings_ListStatuses_StatusId",
                        column: x => x.StatusId,
                        principalTable: "ListStatuses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserListSettings_StatusId",
                table: "UserListSettings",
                column: "StatusId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserListSettings");
        }
    }
}
