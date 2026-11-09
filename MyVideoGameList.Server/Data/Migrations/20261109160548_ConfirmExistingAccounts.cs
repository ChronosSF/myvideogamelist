using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Marks every account that already exists as confirmed, as sign-in starts to require it (ADR 0089).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every account before this one registered when nothing was confirmed and nothing could be: there
    /// was no sender. Requiring confirmation without this would lock every one of them out, the owner's
    /// own among them. None was ever proved to own its address, and this says it was. That is the price
    /// of turning confirmation on now rather than later, when the accounts it would lock out would be
    /// other people's.
    /// </para>
    /// <para>
    /// The down migration does nothing. Which accounts were unconfirmed before is not recorded anywhere,
    /// and unconfirming every account would lock out the ones that have confirmed since.
    /// </para>
    /// </remarks>
    public partial class ConfirmExistingAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""UPDATE "AspNetUsers" SET "EmailConfirmed" = TRUE WHERE NOT "EmailConfirmed";""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
