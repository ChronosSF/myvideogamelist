using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The signed-in user's history: what they did and when, read from the rows that record it.
/// </summary>
public interface IHistoryService
{
    /// <summary>
    /// One page of the user's history, newest first, continuing after <paramref name="after"/>.
    /// </summary>
    /// <param name="after">
    /// The <see cref="HistoryPageDto.Next"/> of the previous page, or null for the first. An empty
    /// <c>?after=</c> reaches here as null — model binding makes it so — and is the first page too:
    /// it names no position, which is different from naming one this history never issued.
    /// </param>
    /// <exception cref="ArgumentException">
    /// <paramref name="after"/> is not a cursor this history issued. Never read as "from the start",
    /// which would show the reader the first page again as though it were the next.
    /// </exception>
    Task<HistoryPageDto> GetHistoryAsync(
        string userId, string? after, CancellationToken cancellationToken = default);
}
