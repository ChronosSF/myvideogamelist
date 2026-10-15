using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Everything this application runs on a schedule, and the host contract those services are
/// written against.
/// </summary>
/// <remarks>
/// <para>
/// One call site rather than a line per service in <c>Program.cs</c>, because the services are not
/// the whole of what scheduled work needs. <see cref="HostOptions"/> decides what happens when one
/// of them throws, and that decision belongs beside the registrations it governs rather than being
/// inherited from a framework default nobody looked up. See
/// <c>docs/decisions/0038-where-scheduled-work-lives.md</c>.
/// </para>
/// <para>
/// <b>This is the only place that configures <see cref="HostOptions"/>.</b> Options are applied in
/// registration order, so a second <c>Configure&lt;HostOptions&gt;</c> anywhere later would win
/// silently — and would make the reasoning written into <see cref="ImportRetentionService"/>,
/// <see cref="GameCacheRefreshService"/> and <see cref="SteamNewsRefreshService"/> wrong without
/// failing anything.
/// </para>
/// </remarks>
public static class ScheduledWork
{
    public static IServiceCollection AddScheduledWork(this IServiceCollection services)
    {
        // Stated, not inherited. Under StopHost an exception escaping a BackgroundService's
        // ExecuteAsync is logged and the process exits, so a hosted service has to catch its own
        // failures or take the whole API down with them — which is why every service below
        // catches per tick. That has been the framework default since .NET 6 (before it, the
        // service died quietly and the host carried on), and setting it here means neither a
        // runtime that changes the default nor a reader assuming the older behaviour can move the
        // ground under that reasoning. Pinned by ImportRetentionTests, which resolves the option
        // out of this registration rather than out of a bare HostOptions.
        services.Configure<HostOptions>(options =>
            options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost);

        // Deleting import jobs past their retention. A hosted service rather than a method
        // somewhere, because nothing requests it — see the class for the scoping, failure and
        // multi-task rules that go with that, which the two below copy.
        services.AddHostedService<ImportRetentionService>();

        // Refreshing CachedGames from IGDB before a reader finds a row a day old (ADR 0052). Its
        // pace is its claim on IGDB's four requests a second, so it is configuration, and a value
        // the job cannot honour stops the host at startup rather than leaving the table to go
        // stale in silence.
        services.AddOptions<GameCacheRefreshOptions>()
            .BindConfiguration(GameCacheRefreshOptions.SectionName)
            .Validate(
                options => options.BatchSize is >= 1 and <= GameCacheRefreshOptions.MaxBatchSize,
                $"{GameCacheRefreshOptions.SectionName}:BatchSize must be between 1 and "
                + $"{GameCacheRefreshOptions.MaxBatchSize}, the most IGDB answers in one request.")
            .Validate(
                options => options.Interval >= GameCacheRefreshOptions.MinInterval
                    && options.Interval <= GameCacheRefresh.Lead,
                $"{GameCacheRefreshOptions.SectionName}:Interval must be between "
                + $"{GameCacheRefreshOptions.MinInterval} and {GameCacheRefresh.Lead}: shorter spends "
                + "IGDB's allowance faster than ADR 0052 provides for, and longer than the hour's lead "
                + "lets rows reach readers between ticks.")
            .ValidateOnStart();
        services.AddHostedService<GameCacheRefreshService>();

        // Fetching the Steam news feeds people are reading before they expire. No database and no
        // lock: it keeps this process's own memory warm, so every task runs its own.
        services.AddHostedService<SteamNewsRefreshService>();

        return services;
    }
}
