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
/// silently — and would make the reasoning written into
/// <see cref="ImportRetentionService"/> wrong without failing anything.
/// </para>
/// </remarks>
public static class ScheduledWork
{
    public static IServiceCollection AddScheduledWork(this IServiceCollection services)
    {
        // Stated, not inherited. Under StopHost an exception escaping a BackgroundService's
        // ExecuteAsync is logged and the process exits, so a hosted service has to catch its own
        // failures or take the whole API down with them — which is why ImportRetentionService
        // catches per tick. That has been the framework default since .NET 6 (before it, the
        // service died quietly and the host carried on), and setting it here means neither a
        // runtime that changes the default nor a reader assuming the older behaviour can move the
        // ground under that reasoning. Pinned by ImportRetentionTests, which resolves the option
        // out of this registration rather than out of a bare HostOptions.
        services.Configure<HostOptions>(options =>
            options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.StopHost);

        // The application's only background job: deleting import jobs past their retention. A
        // hosted service rather than a method somewhere, because nothing requests it — see the
        // class for the scoping, failure and multi-task rules that go with that.
        services.AddHostedService<ImportRetentionService>();

        return services;
    }
}
