using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IHomeService
{
    /// <summary>
    /// Builds the shared, anonymous portion of the home page.
    /// </summary>
    /// <remarks>
    /// Deliberately carries nothing user-specific, so the whole response is cacheable once for
    /// every visitor. The personalised parts of the page — the user's own lists, and what is
    /// coming for their games in the next two weeks — stay as separate client-side calls.
    /// </remarks>
    Task<HomeResponse> GetHomeAsync(CancellationToken cancellationToken = default);
}
