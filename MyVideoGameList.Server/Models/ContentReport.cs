namespace MyVideoGameList.Server.Models;

/// <summary>
/// Why a reader reported something: the terms' own categories (ADR 0076 §1).
/// </summary>
/// <remarks>
/// Keys rather than sentences, so the client words them and the database can hold the list as a check
/// constraint. The terms ask members not to post anything illegal, hateful or harassing, anything they
/// have no right to post, or spam, and not to choose a name or a picture that pretends to be somebody
/// else or is offensive; <see cref="Other"/> is for what none of those says.
/// </remarks>
public static class ReportReason
{
    public const string Spam = "spam";

    /// <summary>Hateful, harassing or offensive.</summary>
    public const string Abuse = "abuse";

    /// <summary>Pretends to be somebody else.</summary>
    public const string Impersonation = "impersonation";

    public const string Illegal = "illegal";

    /// <summary>Not the poster's to post: somebody else's words or picture.</summary>
    public const string Rights = "rights";

    public const string Other = "other";

    public static readonly string[] All = [Spam, Abuse, Impersonation, Illegal, Rights, Other];
}

/// <summary>
/// One reader's report of one published review, or of one public profile's name, picture and bio.
/// </summary>
/// <remarks>
/// <para>
/// <b>The reporter's data, and it says so with <see cref="UserId"/>.</b> The ownership guard finds a
/// member's tables by that column, so a report is deleted with the reporter's account and is in the
/// reporter's export (ADR 0024). The admin page never shows it: it is there to hold a reader to one
/// report of each thing, by two filtered unique indexes, and to be deleted with them.
/// </para>
/// <para>
/// <b>Exactly one of <see cref="ReviewId"/> and <see cref="ProfileUserId"/></b>, which a check constraint
/// holds. Both cascade, so a review deleted by its author, or an account deleted, takes the reports about
/// it: nothing is left for an admin to act on. Both are optional, so the guard's rule for a required
/// pointer to a parent does not reach them; they cascade because a report about nothing is nothing.
/// </para>
/// <para>
/// <b>It lives until an admin answers it</b>, by acting on what it reports or by dismissing it, and is
/// then deleted. There is no resolved state: once answered nothing reads it, and kept it would be a
/// record of who complained about whom. See <c>docs/decisions/0076-*</c>.
/// </para>
/// </remarks>
public class ContentReport
{
    /// <summary>How long a note may be: a few sentences for an admin, not a second review.</summary>
    public const int NoteMaxLength = 500;

    public int Id { get; set; }

    /// <summary>The reader who reported it.</summary>
    public required string UserId { get; set; }

    /// <summary>The review reported, or null when it is a profile.</summary>
    public int? ReviewId { get; set; }

    /// <summary>The account whose profile was reported, or null when it is a review.</summary>
    public string? ProfileUserId { get; set; }

    /// <summary>One of <see cref="ReportReason"/>.</summary>
    public required string Reason { get; set; }

    /// <summary>What the reader added for the admin, as plain text, or null for nothing.</summary>
    public string? Note { get; set; }

    /// <summary>When the reader first reported it. Reporting it again changes the reason and the note.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public Review? Review { get; set; }
    public ApplicationUser? ProfileUser { get; set; }
}
