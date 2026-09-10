using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Turns Identity's <c>UserName</c> into the public handle, and gives every account a say in
    /// whether it has a public page at all.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The interesting part is the backfill. Until now <c>UserName</c> held the account's email
    /// address, because registration set both to the same string and nothing ever read the former.
    /// From here it is a namespace: unique, public, and part of a URL. Every row that predates this
    /// therefore holds a value that is not a legal handle, and there is no way to ask those
    /// accounts what they would like — so the migration picks one for them, deterministically, and
    /// the rename endpoint lets them change it.
    /// </para>
    /// <para>
    /// The derived name is <em>not</em> published by that act: <c>ProfileVisibility</c> defaults to
    /// private, so a handle derived from somebody's email address does not become a public page
    /// until they say so. That ordering is the whole reason the two columns ship in one migration.
    /// </para>
    /// </remarks>
    public partial class AddUserNamesAndProfileVisibility : Migration
    {
        /// <summary>
        /// Derives a handle per account and writes it, with collisions resolved by a numeric
        /// suffix.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Only rows whose current username is not already a legal handle are touched. That
        /// condition is redundant today — this migration is what introduces legal handles — but it
        /// is what makes the statement safe to re-run against a database somebody has already
        /// half-migrated by hand, and it costs one predicate.
        /// </para>
        /// <para>
        /// The suffix is assigned by <c>row_number()</c> over the rows sharing a derived name,
        /// ordered by the account id, so two runs against the same data produce the same names.
        /// A random or sequence-driven suffix would not, and "who got <c>alex</c> and who got
        /// <c>alex_2</c>" is not a question that should have a different answer on staging than in
        /// production.
        /// </para>
        /// </remarks>
        private const string BackfillUserNames = """
            WITH candidates AS (
                SELECT
                    "Id",
                    -- The local part of the address, stripped of everything the policy disallows
                    -- and lowercased, because handles are compared case-insensitively.
                    lower(regexp_replace(
                        split_part(COALESCE("Email", "UserName", ''), '@', 1),
                        '[^A-Za-z0-9_]', '', 'g')) AS raw
                FROM "AspNetUsers"
                WHERE "UserName" IS NULL OR "UserName" !~ '^[A-Za-z0-9_]{3,20}$'
            ),
            seeds AS (
                SELECT
                    "Id",
                    -- Padded rather than rejected: an address like "j@example.com" has to produce
                    -- something, and a name too short for the policy would be unusable by the very
                    -- endpoint meant to let the user change it.
                    left(CASE WHEN length(raw) >= 3 THEN raw ELSE raw || 'player' END, 20) AS handle
                FROM candidates
            ),
            numbered AS (
                SELECT "Id", handle, row_number() OVER (PARTITION BY handle ORDER BY "Id") AS n
                FROM seeds
            ),
            final AS (
                SELECT
                    "Id",
                    CASE
                        WHEN n = 1 THEN handle
                        -- Truncated first so the suffix cannot push the name past the limit.
                        ELSE left(handle, 20 - (length(n::text) + 1)) || '_' || n::text
                    END AS handle
                FROM numbered
            )
            UPDATE "AspNetUsers" AS u
            SET "UserName" = f.handle,
                "NormalizedUserName" = upper(f.handle)
            FROM final AS f
            WHERE u."Id" = f."Id";
            """;

        /// <summary>
        /// Puts the email address back in the username column, which is where it was.
        /// </summary>
        /// <remarks>
        /// Lossy in one direction only, and knowingly: the handles are discarded, so re-applying
        /// this migration re-derives them rather than restoring what anyone had renamed themselves
        /// to. A username history table to make that reversible would be a bigger commitment than
        /// the rollback is worth.
        /// </remarks>
        private const string RestoreEmailUserNames = """
            UPDATE "AspNetUsers"
            SET "UserName" = "Email",
                "NormalizedUserName" = upper("Email")
            WHERE "Email" IS NOT NULL;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProfileVisibility",
                table: "AspNetUsers",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "private");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UserNameChangedAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);

            // Before the constraint, so a row that somehow held something else fails the ALTER
            // rather than being quietly rewritten.
            migrationBuilder.Sql(BackfillUserNames);

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_ProfileVisibility",
                table: "AspNetUsers",
                sql: "\"ProfileVisibility\" IN ('public', 'private')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_ProfileVisibility",
                table: "AspNetUsers");

            migrationBuilder.Sql(RestoreEmailUserNames);

            migrationBuilder.DropColumn(
                name: "ProfileVisibility",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "UserNameChangedAt",
                table: "AspNetUsers");
        }
    }
}
