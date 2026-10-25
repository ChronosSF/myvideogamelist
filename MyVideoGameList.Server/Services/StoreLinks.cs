using System.Text.RegularExpressions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The stores a game is sold on, for the game page's "Where to play" row (issue 130): one address per
/// store, from what IGDB holds, and no prices.
/// </summary>
/// <remarks>
/// <para>
/// IGDB says it in two places. A game's <c>websites</c> keep a curated link of each kind, and its
/// <c>external_games</c> keep the rows IGDB's store syncs write — several to a store wherever the store
/// sells editions and bundles as products of their own, as the Microsoft Store does with four for
/// Mystic Pathways. Both are read, a store's website row is taken before its synced rows, the first
/// usable row wins, and each store is listed once, in the order of <see cref="Storefronts"/>.
/// </para>
/// <para>
/// An address is kept only on https, on a host that store serves its pages from, and cut at its path.
/// The query goes because IGDB's addresses carry other people's parameters: GOG's affiliate network
/// (<c>cjdata=…&amp;utm_medium=affiliate</c>), Steam curators' referrals (<c>curator_clanid</c>),
/// <c>utm_source=igdb</c> and Google's <c>srsltid</c>, and no store's game page needs one. The host check
/// stops a misfiled row — an Epic link to <c>www.xbox.com</c>, a Steam link to a workshop item on
/// <c>steamcommunity.com</c>, a typo of <c>store.epicgames.coms</c> — being shown under a store's name.
/// A row whose address carries a key to a page that is not public yet, which some itch.io rows do, is
/// passed over rather than cut, since the cut address would only lead to a closed door.
/// </para>
/// <para>
/// Every id and host here was read off live IGDB on 2026-10-17: the ids from <c>website_types</c> and
/// <c>external_game_sources</c>, the hosts from the newest and the oldest 2,000 rows of each kind. Two
/// sources are left out on purpose: "Xbox Marketplace" (31) is the Xbox 360 store, which has closed, and
/// its addresses redirect to a generic browse page; "Xbox Game Pass Ultimate Cloud" (54) is a
/// subscription, not somewhere to buy the game. IGDB still files some of the closed store's addresses
/// under "Microsoft" (11), on <c>marketplace.xbox.com</c>, which is not one of that store's hosts here.
/// </para>
/// </remarks>
internal static partial class StoreLinks
{
    // website_types, named as IGDB names them.
    private const int SteamWebsite = 13;
    private const int ItchWebsite = 15;
    private const int EpicWebsite = 16;
    private const int GogWebsite = 17;
    private const int XboxWebsite = 22;
    private const int PlaystationWebsite = 23;
    private const int NintendoWebsite = 24;

    // external_game_sources, named as IGDB names them. There is none for the Nintendo eShop.
    private const int SteamSource = 1;
    private const int GogSource = 5;
    private const int MicrosoftSource = 11;
    private const int EpicGamesStoreSource = 26;
    private const int ItchioSource = 30;
    private const int PlaystationStoreUsSource = 36;

    /// <summary>
    /// One store: the name the page shows, the IGDB ids that mean it, and the hosts its pages are on.
    /// <see cref="Subdomains"/> admits any subdomain of those hosts as well, which is how itch.io gives
    /// every creator a page of their own. <see cref="Pages"/>, where a store has one, is the shape a path
    /// to one of its products takes; any other store takes any path but its front page.
    /// </summary>
    private sealed record Storefront(
        string Name,
        int WebsiteType,
        int? ExternalSource,
        string[] Hosts,
        bool Subdomains = false,
        Regex? Pages = null)
    {
        public bool Serves(string host) =>
            Hosts.Any(own => host.Equals(own, StringComparison.OrdinalIgnoreCase)
                || (Subdomains && host.EndsWith("." + own, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>The stores the row can show, in the order it shows them.</summary>
    private static readonly Storefront[] Storefronts =
    [
        // Steam's own pages: a game, a package or a bundle — Cairn's deluxe edition is a bundle. Some of
        // its website rows are none of them, with a workshop item pasted after the host
        // (`/http://steamcommunity.com/sharedfiles/…`), and the game's synced row answers instead.
        new("Steam", SteamWebsite, SteamSource, ["store.steampowered.com"], Pages: SteamPages()),
        new("GOG", GogWebsite, GogSource, ["www.gog.com", "gog.com"]),
        new("Epic Games Store", EpicWebsite, EpicGamesStoreSource,
            ["store.epicgames.com", "www.epicgames.com", "epicgames.com"]),
        new("PlayStation Store", PlaystationWebsite, PlaystationStoreUsSource, ["store.playstation.com"]),

        // IGDB's "Microsoft" rows point at www.microsoft.com and www.xbox.com alike, and the first
        // redirects to the second: one store, under the name it trades as.
        new("Microsoft Store", XboxWebsite, MicrosoftSource, ["www.xbox.com", "www.microsoft.com"]),
        new("Nintendo eShop", NintendoWebsite, null, ["www.nintendo.com"]),
        new("itch.io", ItchWebsite, ItchioSource, ["itch.io"], Subdomains: true),
    ];

    /// <summary>
    /// One link for each store IGDB names for the game, in <see cref="Storefronts"/> order, and an empty
    /// list when it names none the page links to.
    /// </summary>
    internal static List<StoreLinkDto> Map(
        IReadOnlyCollection<IgdbWebsite>? websites, IReadOnlyCollection<IgdbExternalGame>? externalGames)
    {
        var links = new List<StoreLinkDto>();

        foreach (var store in Storefronts)
        {
            // Each source in id order, so that a store with several rows gives the same answer on every
            // read rather than whichever row IGDB happened to list first.
            var fromWebsites = (websites ?? [])
                .Where(website => website.Type == store.WebsiteType)
                .OrderBy(website => website.Id)
                .Select(website => website.Url);

            // A synced row without an address is passed over, never given one built from its id: it is
            // how IGDB records a game the store has stopped selling (see IgdbExternalGame.Url).
            var fromExternalGames = (externalGames ?? [])
                .Where(row => store.ExternalSource is { } source && row.ExternalGameSource == source)
                .OrderBy(row => row.Id)
                .Select(row => row.Url);

            var page = fromWebsites
                .Concat(fromExternalGames)
                .Select(url => PageOn(store, url))
                .FirstOrDefault(address => address is not null);

            if (page is not null) links.Add(new StoreLinkDto(store.Name, page));
        }

        return links;
    }

    /// <summary>
    /// The address of a page on the store, cut to its path, or null when it is not one: not https, on
    /// another host or port, the store's front page rather than a game's, or a page that only opens with
    /// a key in its address.
    /// </summary>
    private static string? PageOn(Storefront store, string? url)
    {
        if (!Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var address)) return null;
        if (address.Scheme != Uri.UriSchemeHttps || !address.IsDefaultPort) return null;
        if (!store.Serves(address.Host) || address.AbsolutePath.Length <= 1) return null;
        if (store.Pages is { } pages && !pages.IsMatch(address.AbsolutePath)) return null;
        if (CarriesAKey(address.Query)) return null;

        return address.GetComponents(
            UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.UriEscaped);
    }

    /// <summary>
    /// Whether the query hands over a key to a page that is not public: itch.io's <c>secret</c> for a
    /// draft or a restricted page, and <c>password</c> for a protected one. Both were in IGDB's rows.
    /// </summary>
    private static bool CarriesAKey(string query) =>
        query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(pair => pair.Split('=', 2)[0])
            .Any(name => name.Equals("secret", StringComparison.OrdinalIgnoreCase)
                || name.Equals("password", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// A path to a Steam product — <c>/app/</c>, <c>/sub/</c> or <c>/bundle/</c>, its id, and anything
    /// after — behind any number of slashes, since IGDB holds some as <c>//app/…</c> and Steam serves them.
    /// </summary>
    [GeneratedRegex(@"^/+(?:app|sub|bundle)/[0-9]{1,10}(?:/|$)", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex SteamPages();
}
