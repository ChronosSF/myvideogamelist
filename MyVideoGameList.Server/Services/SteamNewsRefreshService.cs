namespace MyVideoGameList.Server.Services;

/// <summary>
/// Fetches the Steam news feeds people are reading again before they expire, so that the reader
/// who arrives after the expiry does not pay Steam's round trip.
/// </summary>
/// <remarks>
/// <para>
/// The work is <see cref="ISteamNewsService.RefreshFeedsAsync"/>; this is only its timer, with the
/// two rules every hosted service here owes the host (ADR 0038): it is a <b>singleton</b> — which
/// costs nothing, since what it calls is one too and touches no database — and it <b>catches per
/// tick</b>, because an exception escaping <c>ExecuteAsync</c> stops the whole API.
/// </para>
/// <para>
/// <b>Unlike the other two it takes no advisory lock, and runs in every task.</b> What it refreshes
/// is this process's own <c>IMemoryCache</c>: a lock would let one task warm its own copy and leave
/// every other task's to go cold. ADR 0012 deferred this job because a per-instance one "would
/// duplicate the same work across every ECS task", and that is answered by what it refreshes
/// rather than by a lock: only the feeds this task's own readers have read since they were last
/// fetched — feeds this task fetches for its readers anyway. What it adds is at most one request per
/// feed after its last read: the copy fetched ahead of an expiry that nobody then reads, which is let
/// go when it next falls due. See <c>docs/decisions/0052-*</c>.
/// </para>
/// </remarks>
internal sealed class SteamNewsRefreshService(
    ISteamNewsService steamNews,
    TimeProvider clock,
    ILogger<SteamNewsRefreshService> logger) : BackgroundService
{
    /// <summary>
    /// How often to look for feeds about to expire. Well inside <c>SteamNewsService.RefreshLead</c>,
    /// so each feed is due on more than one tick and a failed fetch is tried again before its copy
    /// runs out.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Nothing at startup, unlike the jobs on the database: a process that has just started
        // has served no feed, so it has nothing to keep warm.
        using var timer = new PeriodicTimer(Interval, clock);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunOnceAsync(stoppingToken);
        }
    }

    /// <summary>One tick, which never throws except to stop.</summary>
    internal async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            await steamNews.RefreshFeedsAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down, which is not a failure.
            throw;
        }
        catch (Exception e)
        {
            // Nothing in the refresh should throw for Steam, so this is a bug rather than an
            // outage, and it is still not worth the host: the feeds expire and are fetched by their
            // readers, exactly as they were before this ran.
            logger.LogError(e, "Steam news refresh failed; it will be retried on the next tick.");
        }
    }
}
