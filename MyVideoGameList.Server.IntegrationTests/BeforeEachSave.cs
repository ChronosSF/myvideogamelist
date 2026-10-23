using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Runs a step as each save of the context it is attached to begins, numbered from one: the moment
/// a write that has read its rows is about to send them.
/// </summary>
/// <remarks>
/// Shared by the two writes that save again when a row they read is deleted before they write it: the
/// hand order's store and the bulk move.
/// </remarks>
internal sealed class BeforeEachSave(Func<int, Task> step) : SaveChangesInterceptor
{
    public int Saves { get; private set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        await step(++Saves);
        return result;
    }
}
