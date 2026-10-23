namespace MyVideoGameList.Server.Models;

/// <summary>
/// One game in a list its owner can put in an order by hand — the backlog's "what I will play
/// next" and the favourites showcase (ADR 0064), and whatever is arranged the same way after them.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Position"/> is a sparse number, not an index. Positions are spaced
/// <see cref="HandOrder.Step"/> apart when they are first handed out, so moving one game is
/// normally one row: it takes a number between its new neighbours'. Only when two neighbours have
/// no number left between them does the client spread a few of them out again, and it sends those
/// rows too. Nothing renumbers the whole list on every move.
/// </para>
/// <para>
/// Null means the game has never been placed. Placed games come first, in ascending order; the
/// rest follow in the order the list's own comparator gives them, so a list nobody has arranged needs
/// no rows written at all, and a game that arrives later takes no place nobody gave it. The backlog
/// queues its unplaced games oldest first, so an arrival waits at the end (ADR 0054); the favourites
/// showcase shows them newest first, as every favourite was shown before it had an order, so an arrival
/// shows right after the placed (ADR 0064).
/// </para>
/// <para>
/// The client computes every number and the server stores what it is sent, checked against
/// <see cref="HandOrder.MinPosition"/> and <see cref="HandOrder.MaxPosition"/>. The order is a
/// presentation of rows the client already holds whole, which is the line ADR 0020 drew for every
/// other sort.
/// </para>
/// </remarks>
public interface IHandOrdered
{
    string UserId { get; }

    /// <summary>IGDB game ID.</summary>
    int GameId { get; }

    /// <summary>Where the owner put this game, or null when they have not placed it.</summary>
    int? Position { get; set; }
}

/// <summary>The bounds every hand-ordered position keeps to, on both sides of the API.</summary>
public static class HandOrder
{
    /// <summary>
    /// The gap the client leaves between positions it hands out in a run, and the step it moves
    /// by to put a game before the first or after the last. Here for the record; the server never
    /// uses it.
    /// </summary>
    public const int Step = 1024;

    /// <summary>
    /// The lowest position the API stores. Short of the integer's own limit on purpose: the sum or
    /// the difference of any two stored positions still fits in an <c>int</c>, so nothing that
    /// computes a midpoint or a step from two of them has to think about overflow. That leaves
    /// nearly a million steps either way before the client has to spread the list out again.
    /// </summary>
    public const int MinPosition = -1_000_000_000;

    /// <summary>The highest position the API stores. See <see cref="MinPosition"/>.</summary>
    public const int MaxPosition = 1_000_000_000;

    /// <summary>
    /// The most positions one write may carry. A move is one row and a spread a handful; the bound
    /// is there for the move that first places a game deep in a list nobody has arranged, which
    /// writes every unplaced game in front of it.
    /// </summary>
    public const int MaxWrites = 10_000;

    /// <summary>
    /// The most a write of positions may weigh, in bytes, checked before the body is read.
    /// <see cref="MaxWrites"/> positions at their longest are about 450 KB; without this the body could
    /// be Kestrel's default of 30 MB, read whole into a million positions before the bound on their
    /// number refused them, by any signed-in account and as often as it liked.
    /// </summary>
    public const int MaxRequestBytes = 1024 * 1024;
}
