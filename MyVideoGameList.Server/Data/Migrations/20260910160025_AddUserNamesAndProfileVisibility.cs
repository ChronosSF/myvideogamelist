using Microsoft.EntityFrameworkCore.Migrations;
using MyVideoGameList.Server.Models;

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
        /// The shape a legal handle has, as a PostgreSQL regular expression — the policy's alphabet
        /// and length bounds, built from the same constants the policy checks against.
        /// </summary>
        private static readonly string LegalHandle =
            $"^[A-Za-z0-9_]{{{UserNamePolicy.MinLength},{UserNamePolicy.MaxLength}}}$";

        /// <summary>
        /// The reserved names as a SQL <c>VALUES</c> list, uppercased to match the index. Quoted
        /// without escaping, which is safe because the policy keeps every entry to plain lower-case
        /// letters — <c>UserNamePolicyTests</c> pins that.
        /// </summary>
        private static readonly string ReservedNameRows = string.Join(
            ", ", UserNamePolicy.ReservedNames.Select(name => $"('{name.ToUpperInvariant()}')"));

        /// <summary>
        /// Derives a handle per account and writes it, stepping around every name already in use
        /// and every name nobody may claim.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Only rows whose current username is not already a legal handle are touched. That
        /// condition is redundant today — this migration is what introduces legal handles — but it
        /// is what makes the statement safe to re-run against a database somebody has already
        /// half-migrated by hand, and it costs one predicate.
        /// </para>
        /// <para>
        /// Uniqueness is settled against the whole namespace, not within the rows that share a
        /// seed. The first cut numbered collisions with <c>row_number()</c> per seed, and that is
        /// not the same thing: local parts <c>alex</c>, <c>alex</c> and <c>alex_2</c> came out as
        /// <c>alex</c>, <c>alex_2</c> and <c>alex_2</c>, and a handle that was already legal before
        /// the migration was never in any partition at all. Either aborts the whole migration on
        /// <c>UserNameIndex</c>. So this walks the candidates in account-id order and gives each the
        /// first of <c>seed</c>, <c>seed_2</c>, <c>seed_3</c>… not yet in a set that starts out
        /// holding every existing legal handle and every reserved name, and grows with each
        /// assignment. Deterministic for the same reason the first cut was: same rows, same order,
        /// same answers — "who got <c>alex</c> and who got <c>alex_2</c>" should not differ between
        /// staging and production.
        /// </para>
        /// <para>
        /// The reserved list comes from <see cref="UserNamePolicy"/> rather than being restated
        /// here, so an account registered as <c>admin@example.com</c> cannot be handed the one
        /// handle the policy exists to refuse. That makes this migration's SQL depend on live code,
        /// which is unusual for a migration and deliberate: a backfill should agree with the policy
        /// as it stands when it runs, and a name added to the list later changes nothing for a
        /// database that is already past this point.
        /// </para>
        /// </remarks>
        private static readonly string BackfillUserNames = $$"""
            DO $backfill$
            DECLARE
                candidate RECORD;
                seed text;
                handle text;
                n integer;
            BEGIN
                -- Every name that is already somebody's, plus every name nobody may claim, in the
                -- uppercased form the unique index compares.
                CREATE TEMP TABLE mvgl_taken_names (name text PRIMARY KEY);

                INSERT INTO mvgl_taken_names
                    SELECT DISTINCT upper("UserName") FROM "AspNetUsers"
                    WHERE "UserName" ~ '{{LegalHandle}}';

                INSERT INTO mvgl_taken_names VALUES {{ReservedNameRows}}
                ON CONFLICT DO NOTHING;

                FOR candidate IN
                    SELECT "Id", "Email", "UserName" FROM "AspNetUsers"
                    WHERE "UserName" IS NULL OR "UserName" !~ '{{LegalHandle}}'
                    ORDER BY "Id"
                LOOP
                    -- The local part of the address, stripped of everything the policy disallows
                    -- and lowercased, because handles are compared case-insensitively.
                    seed := lower(regexp_replace(
                        split_part(COALESCE(candidate."Email", candidate."UserName", ''), '@', 1),
                        '[^A-Za-z0-9_]', '', 'g'));

                    -- Padded rather than rejected: an address like "j@example.com" has to produce
                    -- something, and a name too short for the policy would be unusable by the very
                    -- endpoint meant to let the user change it.
                    IF length(seed) < {{UserNamePolicy.MinLength}} THEN seed := seed || 'player'; END IF;
                    seed := left(seed, {{UserNamePolicy.MaxLength}});

                    -- The seed itself if nobody has it, otherwise the first free numbered variant.
                    -- Truncated before the suffix goes on, so it cannot push the name past the limit.
                    handle := seed;
                    n := 1;
                    WHILE EXISTS (SELECT 1 FROM mvgl_taken_names WHERE name = upper(handle)) LOOP
                        n := n + 1;
                        handle := left(seed, {{UserNamePolicy.MaxLength}} - length(n::text) - 1)
                            || '_' || n::text;
                    END LOOP;

                    INSERT INTO mvgl_taken_names VALUES (upper(handle));

                    UPDATE "AspNetUsers"
                    SET "UserName" = handle,
                        "NormalizedUserName" = upper(handle)
                    WHERE "Id" = candidate."Id";
                END LOOP;

                DROP TABLE mvgl_taken_names;
            END
            $backfill$;
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
