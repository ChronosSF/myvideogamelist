using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyVideoGameList.Server.Data.Migrations
{
    /// <summary>
    /// Gives every account a public id, the half of its profile's address that is looked up and never
    /// changes (ADR 0096).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The column is added with a default that draws an id for each row</b>, from a function created
    /// first, since PostgreSQL refuses a subquery in a default. Adding a column whose default is
    /// volatile rewrites the table and evaluates the default once per row, so every existing account
    /// gets an id of its own in the same statement that adds the column, and the column is required from
    /// the start. Seen against PostgreSQL 18: two thousand rows took two thousand distinct ids, all well
    /// formed, and a later insert that named no id took one.
    /// </para>
    /// <para>
    /// <b>The default stays after the backfill, for the revision still serving.</b> The migration task
    /// runs before the new revision starts (ADR 0079), and the old one inserts accounts without this
    /// column. Without a default each of those sign-ups would be refused for the whole release. With it
    /// they get an id from the database, and the application sends its own from then on.
    /// </para>
    /// <para>
    /// <b>Under the migration task's five-second lock timeout</b> (ADR 0079): the column, the rewrite, the
    /// index and the check take one lock on <c>AspNetUsers</c>, which waits for whatever the old revision
    /// has open on the table and holds every reader of it for as long as rewriting a few hundred rows
    /// takes. A release refused with <c>55P03</c> is re-run. A collision in the backfill would refuse the
    /// unique index, roll the whole migration back and leave a re-run to draw again; ADR 0096 puts the
    /// odds of one at a few hundred accounts below one in a million million.
    /// </para>
    /// </remarks>
    public partial class AddProfilePublicId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The alphabet and the length are PublicIdPolicy's as this migration was written, stated here
            // rather than read from it: a later change to the policy is a migration of its own.
            migrationBuilder.Sql("""
                CREATE FUNCTION new_public_id() RETURNS character varying(12)
                LANGUAGE sql VOLATILE
                AS $$
                    SELECT string_agg(substr('0123456789bcdfghjkmnpqrstvwxyz', 1 + floor(random() * 30)::int, 1), '')
                    FROM generate_series(1, 12)
                $$;
                """);

            migrationBuilder.AddColumn<string>(
                name: "PublicId",
                table: "AspNetUsers",
                type: "character varying(12)",
                maxLength: 12,
                nullable: false,
                defaultValueSql: "new_public_id()");

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUsers_PublicId",
                table: "AspNetUsers",
                column: "PublicId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_AspNetUsers_PublicId",
                table: "AspNetUsers",
                sql: "\"PublicId\" ~ '^[0123456789bcdfghjkmnpqrstvwxyz]{12}$'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AspNetUsers_PublicId",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AspNetUsers_PublicId",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "PublicId",
                table: "AspNetUsers");

            migrationBuilder.Sql("DROP FUNCTION new_public_id();");
        }
    }
}
