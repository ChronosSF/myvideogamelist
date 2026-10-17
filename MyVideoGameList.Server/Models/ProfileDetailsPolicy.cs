using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// What an account may call itself on its public profile, beside its handle.
/// </summary>
/// <remarks>
/// <para>
/// A display name is not a namespace claim, which is what makes these rules so much looser than
/// <see cref="UserNamePolicy"/>'s (ADR 0027): it is never unique, never looked up and never in a URL,
/// so spaces, punctuation, accents and emoji are all fine, and two accounts may share one. The handle
/// is what identifies an account, and it is shown beside the display name wherever an account is
/// identified, never replaced by it.
/// </para>
/// <para>
/// So the reserved list does not apply either. A display name reading "Support" sits beside
/// <c>@carol</c>, which says who is speaking; refusing a list of words in free text would not stop
/// "Support Team" or "S u p p o r t", and the handle already does.
/// </para>
/// <para>
/// The shape is <see cref="ListNamePolicy"/>'s: trimmed, every run of whitespace one space, and
/// nothing left in the control range. A blank means "no display name".
/// </para>
/// </remarks>
public static partial class DisplayNamePolicy
{
    /// <summary>
    /// Room for a full name in most of the world's naming conventions, and short enough to sit beside
    /// a twenty-character handle in a profile's header. Counted in UTF-16 code units, as the client's
    /// <c>maxlength</c> counts it, so the two agree.
    /// </summary>
    public const int MaxLength = 50;

    /// <summary>
    /// The name as it will be stored: trimmed, with every run of whitespace inside it one space. Null
    /// for a name that is nothing but whitespace, which clears it.
    /// </summary>
    public static string? Normalise(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Whitespace().Replace(name.Trim(), " ");
    }

    /// <summary>Why a normalised name cannot be used, or null when it can.</summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A display name can be at most {MaxLength} characters.";

        // Whitespace has already been folded into spaces, so anything left in the control range is a
        // character with no business in a name — a NUL, a bell — rather than a stray line break.
        if (normalised.Any(char.IsControl))
            return "A display name cannot contain control characters.";

        return null;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}

/// <summary>
/// What an account may say about itself on its public profile: a few lines of plain text.
/// </summary>
/// <remarks>
/// <para>
/// <b>Plain text, and that is a property of how it is rendered rather than of what is refused.</b>
/// The bio is written into the page as a text node and never parsed as markup, so <c>&lt;b&gt;</c>
/// shows as those three characters and "a &lt; b" is a perfectly good sentence — refusing angle
/// brackets would refuse the second to guard against the first, which cannot happen. Nothing is
/// linked or formatted either.
/// </para>
/// <para>
/// The whitespace inside it is the owner's: line breaks, runs of spaces and tabs are kept and shown
/// as written. Line endings are stored as one <c>\n</c> whichever a browser sent, so a limit counted
/// over the stored text does not charge two characters for a line break typed in one, and the ends
/// are trimmed, because a blank line before or after the text is nothing anybody meant to publish.
/// </para>
/// </remarks>
public static class BioPolicy
{
    /// <summary>
    /// A paragraph or two: enough to say what you play and how, and short enough that a profile
    /// opens with the person rather than with their essay. Counted in UTF-16 code units, as the
    /// client's <c>maxlength</c> counts it.
    /// </summary>
    public const int MaxLength = 500;

    /// <summary>
    /// The bio as it will be stored: every line ending a <c>\n</c>, trimmed at both ends, and
    /// everything between kept exactly as written. Null for nothing but whitespace, which clears it.
    /// </summary>
    public static string? Normalise(string? bio)
    {
        if (string.IsNullOrWhiteSpace(bio)) return null;
        return bio.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
    }

    /// <summary>Why a normalised bio cannot be used, or null when it can.</summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"A bio can be at most {MaxLength} characters.";

        // A line break and a tab are text; a NUL, an escape or a bell is not, and has no business in
        // something rendered on a public page.
        if (normalised.Any(c => char.IsControl(c) && c is not '\n' and not '\t'))
            return "A bio can contain line breaks and tabs, but no other control characters.";

        return null;
    }
}

/// <summary>
/// Where an account's picture may come from.
/// </summary>
/// <remarks>
/// <para>
/// <b>An address, never a file.</b> An upload is user-generated content with storage, size limits
/// and moderation behind it, and this is the cut that needs none of them. The address is stored as
/// given and never fetched by this server, so there is nothing here for an address to make the
/// server reach.
/// </para>
/// <para>
/// <b>What it costs instead is a request from every reader's browser to the address's host</b>, with
/// the reader's IP address on it, made before anybody chose to make it. So the host has to be one of
/// <see cref="Hosts"/>: services people already keep an avatar on, each seen to serve one over HTTPS
/// without setting a cookie. The list is what keeps the profile's owner from pointing their avatar at
/// a server of their own and logging everybody who reads their page, and it is what lets a privacy
/// notice name every host a reader's browser is sent to. The document policy's <c>img-src</c> names
/// the same hosts, which is what holds when one of them redirects somewhere else. ADR 0056 is the
/// reasoning in full.
/// </para>
/// <para>
/// <b>Checked as a string first and a <see cref="Uri"/> second.</b> What a reader's browser fetches is
/// whatever its own URL parser makes of the stored text, and parsers disagree about odd input — a
/// backslash, a space, an <c>@</c> in the wrong place. So the address may use URL characters only,
/// and the text between <c>https://</c> and the first <c>/</c>, <c>?</c> or <c>#</c> has to be one of
/// the hosts exactly: no credentials, no port, nothing for two parsers to read two ways.
/// </para>
/// </remarks>
public static class AvatarUrlPolicy
{
    /// <summary>
    /// Several times the longest address any of the hosts hands out, and the length the calendar's
    /// curated links are held to.
    /// </summary>
    public const int MaxLength = 512;

    /// <summary>
    /// The hosts an avatar may be loaded from, compared without case.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Every one is also in the document policy's <c>img-src</c></b> —
    /// <c>AVATAR_HOSTS</c> in <c>myvideogamelist.client/src/lib/avatar.ts</c> — and a client test reads
    /// this list to check the two agree. A host here and not there would be saved and then refused by
    /// every reader's browser.
    /// </para>
    /// <para>
    /// A host is added only once it has been seen to answer an avatar over HTTPS without setting a
    /// cookie. That is what keeps Discord's CDN off the list: its image responses set cookies
    /// identifying the reader's device, which on a page nobody consented to is exactly what the
    /// trailer stopped doing on the game page.
    /// </para>
    /// </remarks>
    public static readonly IReadOnlyList<string> Hosts =
    [
        // Gravatar, in every spelling it hands out: the bare and www forms, the old secure one, and
        // the numbered ones WordPress uses.
        "gravatar.com",
        "www.gravatar.com",
        "secure.gravatar.com",
        "0.gravatar.com",
        "1.gravatar.com",
        "2.gravatar.com",

        // GitHub.
        "avatars.githubusercontent.com",

        // Steam, on each of the CDNs its pages and its Web API name.
        "avatars.steamstatic.com",
        "avatars.akamai.steamstatic.com",
        "avatars.fastly.steamstatic.com",

        // Imgur, for a picture that lives nowhere else.
        "i.imgur.com",

        // Twitch.
        "static-cdn.jtvnw.net",
    ];

    /// <summary>The services behind <see cref="Hosts"/>, as the refusal names them.</summary>
    public const string Services = "Gravatar, GitHub, Steam, Imgur or Twitch";

    private const string Scheme = "https://";

    /// <summary>
    /// Everything RFC 3986 allows in a URL besides letters and digits. A space, a backslash, a quote
    /// or a character outside ASCII is not in it, and an address copied from a browser carries those
    /// percent-encoded.
    /// </summary>
    private const string UrlPunctuation = "-._~:/?#[]@!$&'()*+,;=%";

    /// <summary>
    /// The address as it will be stored: as given, less the whitespace around it. Null for a blank,
    /// which clears the avatar and brings back the initial.
    /// </summary>
    public static string? Normalise(string? url) =>
        string.IsNullOrWhiteSpace(url) ? null : url.Trim();

    /// <summary>Why a normalised address cannot be an avatar, or null when it can.</summary>
    public static string? Problem(string normalised)
    {
        if (normalised.Length > MaxLength)
            return $"An avatar's address can be at most {MaxLength} characters.";

        if (!normalised.All(c => char.IsAsciiLetterOrDigit(c) || UrlPunctuation.Contains(c))
            || !normalised.StartsWith(Scheme, StringComparison.OrdinalIgnoreCase)
            || !Uri.TryCreate(normalised, UriKind.Absolute, out var parsed)
            || parsed.Scheme != Uri.UriSchemeHttps)
        {
            return "An avatar has to be the address of an image, starting https://.";
        }

        var authority = Authority(normalised);

        // The host as written, compared with the list, and then with what the parser made of it: the
        // two agreeing is the point. Credentials or a port in the authority match no host.
        return Hosts.Contains(authority, StringComparer.OrdinalIgnoreCase)
            && string.Equals(parsed.Authority, authority, StringComparison.OrdinalIgnoreCase)
                ? null
                : $"An avatar can come from {Services}.";
    }

    /// <summary>The text between the scheme and the first <c>/</c>, <c>?</c> or <c>#</c>.</summary>
    private static string Authority(string url)
    {
        var rest = url[Scheme.Length..];
        var end = rest.IndexOfAny(['/', '?', '#']);
        return end < 0 ? rest : rest[..end];
    }
}
