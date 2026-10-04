using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddReleaseCalendarCuration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CuratedEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Store = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    EndsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Url = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CuratedEvents", x => x.Id);
                    table.CheckConstraint("CK_CuratedEvents_Days", "\"EndsOn\" >= \"StartsOn\"");
                    table.CheckConstraint("CK_CuratedEvents_Kind", "\"Kind\" IN ('sale', 'fest', 'showcase')");
                });

            migrationBuilder.CreateTable(
                name: "ShowcaseNames",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Prefix = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShowcaseNames", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShowcaseNames_Prefix",
                table: "ShowcaseNames",
                column: "Prefix",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CuratedEvents");

            migrationBuilder.DropTable(
                name: "ShowcaseNames");
        }
    }
}
