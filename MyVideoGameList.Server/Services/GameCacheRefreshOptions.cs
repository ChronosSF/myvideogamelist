namespace MyVideoGameList.Server.Services;

/// <summary>
/// The pace of the background refresh of <c>CachedGames</c>: how many games one IGDB request asks
/// about, and how often one is sent.
/// </summary>
/// <remarks>
/// <para>
/// The two are configuration because they are the job's whole claim on IGDB's four requests a
/// second, which browse and search spend too, and the right numbers move with the size of the
/// table rather than with anything in the code. The defaults and the reasoning behind them are
/// ADR 0052: one request a minute carrying fifty ids — 1,440 requests a day, under half of one
/// percent of the budget — which keeps up to 72,000 rows a day fresh, many times what the table
/// holds today.
/// </para>
/// <para>
/// Both are checked when the host starts, by <see cref="ScheduledWork.AddScheduledWork"/>, so a
/// value the job cannot honour stops the process instead of being discovered in production as a
/// table quietly going stale.
/// </para>
/// </remarks>
public sealed class GameCacheRefreshOptions
{
    public const string SectionName = "GameCacheRefresh";

    /// <summary>
    /// The most ids one batch may ask for: IGDB answers at most 500 rows to a request, and a larger
    /// batch would be split into several requests sent back to back, which is the burst the pace
    /// exists to avoid.
    /// </summary>
    public const int MaxBatchSize = 500;

    /// <summary>
    /// The shortest interval allowed. Even at the largest batch, one request every ten seconds is a
    /// fortieth of what IGDB allows; anything shorter would be a different job from the one ADR 0052
    /// describes.
    /// </summary>
    public static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(10);

    /// <summary>
    /// How many cached games one tick refreshes, all in one IGDB request.
    /// </summary>
    public int BatchSize { get; set; } = 50;

    /// <summary>
    /// How long between ticks. Never longer than <see cref="GameCacheRefresh.Lead"/>, or a row
    /// that fell due just after a tick could reach a reader before the next one.
    /// </summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromMinutes(1);
}
