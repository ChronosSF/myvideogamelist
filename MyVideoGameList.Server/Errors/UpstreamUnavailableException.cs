namespace MyVideoGameList.Server.Errors;

/// <summary>
/// A third party that is not IGDB did not answer, with the sentence its 502 should carry.
/// </summary>
/// <remarks>
/// <see cref="UpstreamFailureHandler"/> turns every failed call to somebody else's service into a 502,
/// and the detail it writes is about game data, because IGDB was the only one. A caller of another
/// service throws this instead, so that the answer names what actually failed: a sign-up that could not
/// be checked is not told that its lists are unaffected (ADR 0092). An <see cref="HttpRequestException"/>
/// still, so that whatever handles one handles this.
/// </remarks>
/// <param name="message">What happened, for the log. Nothing from the request.</param>
/// <param name="detail">What the reader is told, as the 502's <c>detail</c>.</param>
/// <param name="innerException">The failure itself, where there was one.</param>
public sealed class UpstreamUnavailableException(string message, string detail, Exception? innerException = null)
    : HttpRequestException(message, innerException)
{
    /// <summary>What the reader is told, as the 502's <c>detail</c>.</summary>
    public string Detail { get; } = detail;
}
