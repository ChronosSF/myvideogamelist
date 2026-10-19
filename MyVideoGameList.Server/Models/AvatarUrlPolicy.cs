namespace MyVideoGameList.Server.Models;

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
/// <see cref="Hosts"/>. The list is what keeps the profile's owner from pointing their avatar at a
/// server of their own and logging everybody who reads their page, and it is what lets a privacy
/// notice name every host a reader's browser is sent to. The document policy's <c>img-src</c> names
/// the same hosts, which is what holds when one of them redirects somewhere else, and the page loads
/// the picture anonymously, so no cookie goes to the host or comes back from it whatever the host
/// starts doing later. ADR 0056 is the reasoning in full.
/// </para>
/// <para>
/// <b>Checked as a string first and a <see cref="Uri"/> second.</b> What a reader's browser fetches is
/// whatever its own URL parser makes of the stored text, and parsers disagree about odd input — a
/// backslash, a space, an <c>@</c> in the wrong place. So the address may use a narrow set of URL
/// characters, and the text between <c>https://</c> and the first <c>/</c>, <c>?</c> or <c>#</c> has
/// to be one of the hosts exactly: no credentials, no port, nothing for two parsers to read two ways.
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
    /// <b>Every one is also in the document policy's <c>img-src</c></b>, through <c>AVATAR_HOSTS</c>
    /// in <c>myvideogamelist.client/src/lib/avatar.ts</c>, and a client test reads this list to check
    /// the two agree. A host here and not there would be saved and then refused by every reader's
    /// browser.
    /// </para>
    /// <para>
    /// <b>A host joins only once it has been seen to serve an avatar over HTTPS</b> with
    /// <c>Access-Control-Allow-Origin</c>, which an anonymous load needs, without setting a cookie,
    /// and without asking the browser to report to it afterwards (<c>NEL</c>, <c>Report-To</c>). That
    /// is what keeps Discord's CDN off the list, whose image responses set three cookies, and Twitch's,
    /// whose ask the browser to report every failed load to <c>nel.twitch.tv</c> for a day. Storing
    /// things in a reader's browser, or having it report on them, from a page nobody consented to is
    /// exactly what the trailer stopped doing on the game page.
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

        // GitHub's avatar host. Not github.com, whose /{user}.png redirects here after setting
        // cookies of its own.
        "avatars.githubusercontent.com",

        // Steam, on the CDNs its pages and its Web API name. Not its Cloudflare one, which redirects
        // to the first of these without the header an anonymous load needs to follow it.
        "avatars.steamstatic.com",
        "avatars.akamai.steamstatic.com",
        "avatars.fastly.steamstatic.com",

        // Imgur, for a picture that lives nowhere else.
        "i.imgur.com",
    ];

    /// <summary>The services behind <see cref="Hosts"/>, as the refusal names them.</summary>
    public const string Services = "Gravatar, GitHub, Steam or Imgur";

    private const string Scheme = "https://";

    /// <summary>
    /// The punctuation an address may hold besides letters and digits: what the listed hosts' own
    /// addresses use, and none of what could carry it out of an attribute or a CSS <c>url()</c> if
    /// it is ever written into one — no quote, bracket, parenthesis, semicolon or space. A character
    /// outside ASCII is not in it either; an address copied from a browser carries one
    /// percent-encoded.
    /// </summary>
    private const string UrlPunctuation = "-._~:/?#@&=+%";

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
            return "An avatar has to be the address of a picture, starting https://.";
        }

        var authority = Authority(normalised);

        // The host as written, compared with the list, and then with what the parser made of it: the
        // two agreeing is the point. Credentials or a port in the authority match no host.
        return Hosts.Contains(authority, StringComparer.OrdinalIgnoreCase)
            && string.Equals(parsed.Authority, authority, StringComparison.OrdinalIgnoreCase)
                ? null
                : $"An avatar has to be a picture's own address on {Services}: right-click the picture "
                    + "there and copy the image address.";
    }

    /// <summary>The text between the scheme and the first <c>/</c>, <c>?</c> or <c>#</c>.</summary>
    private static string Authority(string url)
    {
        var rest = url[Scheme.Length..];
        var end = rest.IndexOfAny(['/', '?', '#']);
        return end < 0 ? rest : rest[..end];
    }
}
