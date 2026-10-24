using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// A user's tags and the games they are on (#135, ADR 0065).
    /// </summary>
    /// <remarks>
    /// Two new tables and nothing else touched, so nothing existing is rewritten. The generated SQL was
    /// read before it was run: one transaction, both links' composite foreign keys — to the entry by
    /// <c>(UserGameEntryId, UserId)</c> and to the tag by <c>(TagId, UserId)</c> — with
    /// <c>ON DELETE CASCADE</c>, and the unique index over <c>(UserId, NormalizedName)</c>. Read it again
    /// after any edit here; the in-memory provider the tests run on enforces none of it.
    /// </remarks>
    public partial class AddEntryTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Tags",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tags", x => x.Id);
                    table.UniqueConstraint("AK_Tags_Id_UserId", x => new { x.Id, x.UserId });
                    table.ForeignKey(
                        name: "FK_Tags_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserGameEntryTags",
                columns: table => new
                {
                    UserGameEntryId = table.Column<int>(type: "integer", nullable: false),
                    TagId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    AddedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserGameEntryTags", x => new { x.UserGameEntryId, x.TagId });
                    table.ForeignKey(
                        name: "FK_UserGameEntryTags_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserGameEntryTags_Tags_TagId_UserId",
                        columns: x => new { x.TagId, x.UserId },
                        principalTable: "Tags",
                        principalColumns: new[] { "Id", "UserId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserGameEntryTags_UserGameEntries_UserGameEntryId_UserId",
                        columns: x => new { x.UserGameEntryId, x.UserId },
                        principalTable: "UserGameEntries",
                        principalColumns: new[] { "Id", "UserId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tags_UserId_NormalizedName",
                table: "Tags",
                columns: new[] { "UserId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEntryTags_TagId_UserId",
                table: "UserGameEntryTags",
                columns: new[] { "TagId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEntryTags_UserGameEntryId_UserId",
                table: "UserGameEntryTags",
                columns: new[] { "UserGameEntryId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_UserGameEntryTags_UserId",
                table: "UserGameEntryTags",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserGameEntryTags");

            migrationBuilder.DropTable(
                name: "Tags");
        }
    }
}
