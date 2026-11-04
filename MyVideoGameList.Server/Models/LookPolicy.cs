namespace MyVideoGameList.Server.Models;

/// <summary>
/// What an account's look may be (ADR 0082, issue 208): a palette, by name, or a custom one of two
/// colours; a background pattern, by name; and whether that pattern is drawn in grey or in the
/// palette's accent.
/// </summary>
/// <remarks>
/// <para>
/// Names rather than values, so that a stored choice says what was chosen and the stylesheet says what it
/// looks like: a preset retuned in a later release reaches everybody who chose it, where a stored set of
/// forty colours would keep each of them on the old one until something rewrote it.
/// </para>
/// <para>
/// What is checked here is the shape: a name the site knows, and a colour written as six hex digits. That
/// a custom palette reads — its text on its background, its button's words on its accent — is the
/// settings page's to check before it saves, because the client has the palette's own colours to measure
/// against and the server would need a second copy of them; a request that skips the check spoils only its
/// own sender's screen.
/// </para>
/// </remarks>
public static class LookPolicy
{
    public const string DefaultPalette = "ink";
    public const string CustomPalette = "custom";

    /// <summary>The palettes, the default first. <c>custom</c> is the one that carries colours of its own.</summary>
    public static readonly IReadOnlyList<string> Palettes = [DefaultPalette, "slate", "dusk", "plum", "graphite", "oxblood", CustomPalette];

    public const string DefaultPattern = "honeycomb";

    /// <summary>The background patterns, the default first, and <c>none</c>.</summary>
    public static readonly IReadOnlyList<string> Patterns = [DefaultPattern, "isometric", "perspective", "pixels", "none"];

    public const string DefaultTint = "grey";

    /// <summary>What the pattern is drawn in: the page's own grey, or the palette's accent.</summary>
    public static readonly IReadOnlyList<string> Tints = [DefaultTint, "accent"];

    /// <summary>A colour as a colour picker writes one, and as it is stored: <c>#</c> and six hex digits.</summary>
    public const string ColourPattern = "^#[0-9a-fA-F]{6}$";

    /// <summary>The longest a stored colour is, which is the only length one can have.</summary>
    public const int ColourLength = 7;

    /// <summary>The longest name of any of the three, for the columns that hold them.</summary>
    public const int NameMaxLength = 16;

    /// <summary>
    /// Whether an account may choose a look: an admin, for now, so that the defaults can be chosen by
    /// trying every look on the site itself, while everybody else is shown the choices as coming soon and
    /// drawn in the default (ADR 0082). Issue 208 decides whether a look is free or paid; that answer goes
    /// here, and in the policy on <c>PUT /api/user/look</c>, and nowhere else.
    /// </summary>
    public static bool CanChoose(bool isAdmin) => isAdmin;

    /// <summary>
    /// The palette an account's stored <see cref="ApplicationUser.Theme"/> names, or the default for
    /// anything else: the <c>dark</c> every account had before palettes, an old <c>light</c>, or a name a
    /// later release retired.
    /// </summary>
    public static string PaletteOf(string? stored) =>
        stored is not null && Palettes.Contains(stored) ? stored : DefaultPalette;
}
