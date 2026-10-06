namespace Infra;

internal static class Connection
{
    /// <summary>
    /// The connection string the API and the migration task share, with no password in it: that
    /// travels separately as the <c>PGPASSWORD</c> secret, which Npgsql reads when the string
    /// carries none, so it exists in exactly one place (ADR 0005, 0044). <c>SSL Mode=Require</c>
    /// is stated because RDS refuses unencrypted connections from PostgreSQL 15 on.
    /// </summary>
    public static string String(DataStack data, Site site) =>
        $"Host={data.Database.InstanceEndpoint.Hostname};Port=5432;Database=myvideogamelist;Username=mvgl;SSL Mode=Require";
}
