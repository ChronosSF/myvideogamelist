using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddImportJobUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAt",
                table: "ImportJobs",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // The generated default is 0001-01-01, which would read as two thousand years of
            // silence and hand every job that already exists to the retention sweep on its next
            // tick. A job nobody has touched since it was uploaded was last touched when it was
            // uploaded.
            migrationBuilder.Sql("""UPDATE "ImportJobs" SET "UpdatedAt" = "CreatedAt";""");

            // And now that every row has a value, the default has no job left to do. Leaving it
            // would put a silent 0001-01-01 behind any later INSERT that omits the column.
            migrationBuilder.Sql("""ALTER TABLE "ImportJobs" ALTER COLUMN "UpdatedAt" DROP DEFAULT;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "ImportJobs");
        }
    }
}
