namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// Paths for the CDN in front of the site to forget, and what happened to make them stale.
/// </summary>
/// <param name="Reason">
/// What happened, in a few words, for the log: <c>profile made private</c>. It never carries the
/// account id; the paths already say whose page it is.
/// </param>
/// <param name="Paths">
/// As CloudFront takes them: from the site's root, with a <c>*</c> only as the last character,
/// because anywhere else CloudFront matches it as a literal asterisk and invalidates nothing.
/// </param>
public sealed record EdgeInvalidation(string Reason, IReadOnlyList<string> Paths);

/// <summary>
/// Asks the CDN in front of the site to drop what it has cached under some paths.
/// </summary>
/// <remarks>
/// <para>
/// <b>Called after a write commits, and never able to fail it.</b> The reason to invalidate is a
/// withdrawal of consent, and consent withdrawn has to take effect in our own tables whether or
/// not CloudFront is answering — so this returns at once rather than waiting on it. The CloudFront
/// implementation queues the request and sends it from the background; the one used everywhere a
/// distribution is not configured logs what it would have sent. Callers still go through
/// <see cref="ProfileWithdrawals"/>, which catches whatever an implementation throws, because the
/// guarantee belongs to the write and not to whichever class happens to be registered.
/// </para>
/// <para>
/// One call is one invalidation request: the paths of one event travel together and are never
/// split, and two events are never merged. See
/// <c>docs/decisions/0058-a-withdrawal-leaves-the-edge-when-it-is-made.md</c>.
/// </para>
/// </remarks>
public interface IEdgeInvalidator
{
    void Invalidate(EdgeInvalidation invalidation);
}
