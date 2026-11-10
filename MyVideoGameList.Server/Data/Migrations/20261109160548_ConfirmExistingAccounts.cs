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
    /// <b>No cutoff, because the revision still serving during the release confirms nobody.</b> The
    /// migration task runs before the new revision starts, so every row this can see was written by code
    /// that sends no link, and is exactly the kind of account it exists for, whenever it committed. One
    /// that commits after the update stays unconfirmed, and is sent its link the first time it signs in
    /// with its password (ADR 0089 §4).
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
