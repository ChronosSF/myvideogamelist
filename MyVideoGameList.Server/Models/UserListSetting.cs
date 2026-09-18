namespace MyVideoGameList.Server.Models;

/// <summary>
/// What one user calls one of the five status lists, when it is not its default name.
/// </summary>
/// <remarks>
/// <para>
/// A label and nothing else. Renaming Finished to "Beaten" writes a row here and nothing anywhere
/// else notices, because every statistic, the event log and the export key on the status rather than
/// on its name. What a rename can never do is change what a list <em>means</em>: there is no column
/// here for the flags on <see cref="ListStatus"/>, and that absence is the design
/// (<c>docs/data-model-plan.md</c>, decision 8).
/// </para>
/// <para>
/// Lazily created, exactly as <see cref="UserListSortPreference"/> is: no row means the default
/// name, so a user who has renamed nothing has no rows, and a sixth status would need no migration.
/// A name set back to the default removes the row rather than storing a copy of it.
/// </para>
/// <para>
/// The owner's alone. A public profile names the lists by their defaults — see
/// <c>docs/decisions/0031-a-list-rename-is-a-label-its-owner-sees.md</c>.
/// </para>
/// </remarks>
public class UserListSetting
{
    public required string UserId { get; set; }

    /// <summary>The status list this name applies to.</summary>
    public short StatusId { get; set; }

    /// <summary>Normalised by <see cref="ListNamePolicy"/> before it is stored.</summary>
    public required string DisplayName { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ListStatus Status { get; set; } = null!;
}
