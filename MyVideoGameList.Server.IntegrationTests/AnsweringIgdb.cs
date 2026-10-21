using System.Reflection;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// IGDB answering the background refresh's one call — the games for a set of ids, asked fresh —
/// from what a test gives it, and refusing everything else.
/// </summary>
/// <remarks>
/// For the refresh's own tests, whose paths begin once IGDB has answered: through
/// <see cref="UnreachableIgdb"/> every tick would be IGDB failing, which the unit tests already
/// cover. A proxy for the reason that one is: a method added to <see cref="IIgdbService"/> needs no
/// edit here. The factory's own IGDB stays unreachable; this is handed to a refresh a test builds.
/// </remarks>
public sealed class AnsweringIgdb
{
    private readonly Func<IReadOnlyCollection<int>, IReadOnlyList<GameDto>> answer;
    private int calls;

    public AnsweringIgdb(Func<IReadOnlyCollection<int>, IReadOnlyList<GameDto>> answer)
    {
        this.answer = answer;

        var proxy = DispatchProxy.Create<IIgdbService, Proxy>();
        ((Proxy)(object)proxy).Owner = this;
        Service = proxy;
    }

    /// <summary>What the refresh is given in place of <c>IgdbService</c>.</summary>
    public IIgdbService Service { get; }

    /// <summary>How many times the refresh asked.</summary>
    public int Calls => Volatile.Read(ref calls);

    /// <summary>
    /// Has to be public and unsealed with a parameterless constructor, which is what
    /// <see cref="DispatchProxy"/> derives the proxy type from.
    /// </summary>
    public class Proxy : DispatchProxy
    {
        internal AnsweringIgdb Owner { get; set; } = null!;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            ArgumentNullException.ThrowIfNull(targetMethod);

            if (targetMethod.Name != nameof(IIgdbService.GetGamesByIdsUncachedAsync))
            {
                throw new InvalidOperationException(
                    $"Only the refresh's lookup is answered here; {targetMethod.Name} was called.");
            }

            Interlocked.Increment(ref Owner.calls);
            return Task.FromResult(Owner.answer((IReadOnlyCollection<int>)args![0]!));
        }
    }
}
