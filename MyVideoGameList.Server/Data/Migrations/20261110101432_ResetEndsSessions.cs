using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// When an account last ended every session it had, which a password reset does (ADR 0090).
    /// </summary>
    /// <remarks>
    /// A nullable column with no default, so adding it rewrites no row and holds its lock for a moment
    /// (ADR 0079). Null for every account until it resets its password.
    /// </remarks>
    public partial class ResetEndsSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "SessionsEndedAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SessionsEndedAt",
                table: "AspNetUsers");
        }
    }
}
