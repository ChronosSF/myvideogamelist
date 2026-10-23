using System.Collections.Concurrent;
using System.Reflection;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// IGDB as these tests have it: never reachable. Every call is recorded and then fails the way a
/// dropped connection does.
/// </summary>
/// <remarks>
/// <para>
/// Nothing here may reach IGDB. Continuous integration has no credentials for it, and a developer's
/// user secrets are not loaded by the environment the factory runs in. So the double answers
/// nothing, and failing the way an outage fails is the most honest thing it can do: an
/// <see cref="HttpRequestException"/> is what <c>UpstreamFailureHandler</c> turns into a 502, and
/// what <c>GameCacheService</c> swallows to serve its own rows (ADR 0034, 0035). A test that
/// reaches IGDB by accident therefore gets the answer production would give during an outage,
/// never a plausible game.
/// </para>
/// <para>
/// Recorded because "nothing asked IGDB" is a claim several records make — a list renders from
/// <c>CachedGames</c>, the export makes no call — and <see cref="Calls"/> is how a test says it.
/// </para>
/// <para>
/// A proxy rather than a class implementing the interface by hand, so a method added to
/// <see cref="IIgdbService"/> is unreachable here the day it is added, without this project
/// having to be edited for a call none of its tests make.
/// </para>
/// </remarks>
public sealed class UnreachableIgdb
{
    private readonly ConcurrentQueue<string> calls = new();

    public UnreachableIgdb()
    {
        var proxy = DispatchProxy.Create<IIgdbService, Proxy>();
        ((Proxy)(object)proxy).Owner = this;
        Service = proxy;
    }

    /// <summary>What the application is given in place of <c>IgdbService</c>.</summary>
    public IIgdbService Service { get; }

    /// <summary>The name of every <see cref="IIgdbService"/> method called, in order.</summary>
    public IReadOnlyList<string> Calls => calls.ToArray();

    /// <summary>
    /// The calls made since <paramref name="mark"/>, a count of <see cref="Calls"/> taken earlier.
    /// One double serves a whole class, so a test asks about its own calls and nobody else's.
    /// </summary>
    public IReadOnlyList<string> CallsSince(int mark) => Calls.Skip(mark).ToList();

    /// <summary>
    /// Has to be public and unsealed with a parameterless constructor, which is what
    /// <see cref="DispatchProxy"/> derives the proxy type from.
    /// </summary>
    public class Proxy : DispatchProxy
    {
        internal UnreachableIgdb Owner { get; set; } = null!;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            ArgumentNullException.ThrowIfNull(targetMethod);
            Owner.calls.Enqueue(targetMethod.Name);

            var failure = new HttpRequestException(
                $"IGDB is not reachable from the integration tests; {targetMethod.Name} was called.");

            // A faulted task rather than a throw, because that is what an async method does with an
            // exception: a caller that starts the call before awaiting it, as a fan-out does, must
            // see the failure where it awaits, exactly as it would see a real one.
            var returns = targetMethod.ReturnType;

            if (returns == typeof(Task)) return Task.FromException(failure);

            if (returns.IsGenericType && returns.GetGenericTypeDefinition() == typeof(Task<>))
            {
                return FromException
                    .MakeGenericMethod(returns.GetGenericArguments()[0])
                    .Invoke(null, [failure]);
            }

            // Every member is a Task today. Anything else fails at the call, which is what an
            // interface member with no task to fault could do anyway.
            throw failure;
        }

        private static readonly MethodInfo FromException =
            typeof(Task).GetMethod(nameof(Task.FromException), 1, [typeof(Exception)])!;
    }
}
