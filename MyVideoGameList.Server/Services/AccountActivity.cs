namespace MyVideoGameList.Server.Services;

/// <summary>
/// When an account's <see cref="Models.ApplicationUser.LastSeenAt"/> is worth writing again (ADR 0051).
/// </summary>
public static class AccountActivity
{
    /// <summary>
    /// Whether <paramref name="lastSeenAt"/> is unknown or from an earlier UTC day than
    /// <paramref name="now"/>: one write a day, which is all the statistics read.
    /// </summary>
    /// <remarks>
    /// Compared as UTC dates, whatever offset either was taken in, so that a day means the same to
    /// every server and every member.
    /// </remarks>
    public static bool IsNewDay(DateTimeOffset? lastSeenAt, DateTimeOffset now) =>
        lastSeenAt is null || lastSeenAt.Value.UtcDateTime.Date < now.UtcDateTime.Date;
}
