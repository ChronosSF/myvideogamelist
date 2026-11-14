using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "HiddenAt",
                table: "Reviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ContentReports",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    ReviewId = table.Column<int>(type: "integer", nullable: true),
                    ProfileUserId = table.Column<string>(type: "text", nullable: true),
                    Reason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentReports", x => x.Id);
                    table.CheckConstraint("CK_ContentReports_OneSubject", "(\"ReviewId\" IS NULL) <> (\"ProfileUserId\" IS NULL)");
                    table.CheckConstraint("CK_ContentReports_Reason", "\"Reason\" IN ('spam', 'abuse', 'impersonation', 'illegal', 'rights', 'other')");
                    table.ForeignKey(
                        name: "FK_ContentReports_AspNetUsers_ProfileUserId",
                        column: x => x.ProfileUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ContentReports_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ContentReports_Reviews_ReviewId",
                        column: x => x.ReviewId,
                        principalTable: "Reviews",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_HiddenAt",
                table: "Reviews",
                column: "HiddenAt",
                filter: "\"HiddenAt\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_ProfileUserId",
                table: "ContentReports",
                column: "ProfileUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_ReviewId",
                table: "ContentReports",
                column: "ReviewId");

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_UserId_ProfileUserId",
                table: "ContentReports",
                columns: new[] { "UserId", "ProfileUserId" },
                unique: true,
                filter: "\"ProfileUserId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_UserId_ReviewId",
                table: "ContentReports",
                columns: new[] { "UserId", "ReviewId" },
                unique: true,
                filter: "\"ReviewId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ContentReports");

            migrationBuilder.DropIndex(
                name: "IX_Reviews_HiddenAt",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "HiddenAt",
                table: "Reviews");
        }
    }
}
