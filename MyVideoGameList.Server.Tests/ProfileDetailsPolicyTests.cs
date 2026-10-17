using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What an account may say about itself on its public profile: a display name, an avatar's address
/// and a bio.
/// </summary>
/// <remarks>
/// The avatar's cases are the ones that matter most, because its address is fetched by every
/// reader's browser from whatever host it names. Each refusal below is an address that would send
/// readers somewhere the host list does not name, or that two URL parsers could read two ways. See
/// <c>docs/decisions/0056-*</c>.
/// </remarks>
public class ProfileDetailsPolicyTests
{
    // ── Display name ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("  Alex Smith  ", "Alex Smith")]
    [InlineData("Alex \t  Smith", "Alex Smith")]
    [InlineData("Alex\nSmith", "Alex Smith")]
    [InlineData("Ålex Šmith 🎮", "Ålex Šmith 🎮")]
    public void DisplayNameNormalise_TrimsAndFoldsWhitespace(string typed, string stored) =>
        Assert.Equal(stored, DisplayNamePolicy.Normalise(typed));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void DisplayNameNormalise_Blank_IsNoDisplayName(string? typed) =>
        Assert.Null(DisplayNamePolicy.Normalise(typed));

    [Fact]
    public void DisplayNameProblem_UpToTheLimit_IsAccepted()
    {
        Assert.Null(DisplayNamePolicy.Problem("A"));
        Assert.Null(DisplayNamePolicy.Problem(new string('a', DisplayNamePolicy.MaxLength)));
    }

    [Fact]
    public void DisplayNameProblem_OverTheLimit_IsRefused() =>
        Assert.NotNull(DisplayNamePolicy.Problem(new string('a', DisplayNamePolicy.MaxLength + 1)));

    [Theory]
    [InlineData("Alex\0")]
    [InlineData("Alex\u0007Smith")]
    [InlineData("\u001bAlex")]
    public void DisplayNameProblem_ControlCharacter_IsRefused(string typed) =>
        Assert.NotNull(DisplayNamePolicy.Problem(DisplayNamePolicy.Normalise(typed)!));

    [Theory]
    // Not a namespace, so nothing a username refuses is refused here — the handle beside it is what
    // says whose account this is (ADR 0027).
    [InlineData("admin")]
    [InlineData("alex@example.com")]
    [InlineData("The Witcher's #1 fan")]
    public void DisplayNameProblem_WhatAUsernameRefuses_IsAccepted(string typed) =>
        Assert.Null(DisplayNamePolicy.Problem(DisplayNamePolicy.Normalise(typed)!));

    // ── Bio ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void BioNormalise_KeepsTheWhitespaceInside()
    {
        const string bio = "First line.\n\n  Indented,\twith a tab  and two spaces.\nLast line.";

        Assert.Equal(bio, BioPolicy.Normalise(bio));
    }

    [Fact]
    public void BioNormalise_StoresEveryLineEndingAsALineFeed() =>
        Assert.Equal("One\nTwo\nThree", BioPolicy.Normalise("One\r\nTwo\rThree"));

    [Fact]
    public void BioNormalise_TrimsTheEnds() =>
        Assert.Equal("Hello.", BioPolicy.Normalise("\n\n  Hello.  \r\n\r\n"));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \r\n\t ")]
    public void BioNormalise_Blank_IsNoBio(string? typed) =>
        Assert.Null(BioPolicy.Normalise(typed));

    [Fact]
    public void BioProblem_UpToTheLimit_IsAccepted() =>
        Assert.Null(BioPolicy.Problem(new string('a', BioPolicy.MaxLength)));

    [Fact]
    public void BioProblem_OverTheLimit_IsRefused() =>
        Assert.NotNull(BioPolicy.Problem(new string('a', BioPolicy.MaxLength + 1)));

    [Fact]
    public void BioProblem_LineBreaksSentAsCrLf_CountOnce()
    {
        // 250 lines of one character: 499 characters stored, but 748 as a browser posting a form
        // would send them. The limit is on what is stored.
        var typed = string.Join("\r\n", Enumerable.Repeat("a", 250));

        Assert.Null(BioPolicy.Problem(BioPolicy.Normalise(typed)!));
    }

    [Theory]
    [InlineData("Hello\0")]
    [InlineData("Bell \u0007")]
    [InlineData("Escape \u001b[31m red")]
    [InlineData("Form\ffeed")]
    public void BioProblem_ControlCharacterOtherThanALineBreakOrTab_IsRefused(string typed) =>
        Assert.NotNull(BioPolicy.Problem(BioPolicy.Normalise(typed)!));

    [Theory]
    // Plain text is how it is rendered, not what is refused: none of these is markup on the page.
    [InlineData("<b>bold</b> and <script>alert(1)</script>")]
    [InlineData("I <3 RPGs, and 2 < 3")]
    [InlineData("**not bold** [not a link](https://example.com)")]
    public void BioProblem_TextThatLooksLikeMarkup_IsAccepted(string typed) =>
        Assert.Null(BioPolicy.Problem(BioPolicy.Normalise(typed)!));

    // ── Avatar ────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50?s=200")]
    [InlineData("https://www.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50")]
    [InlineData("https://secure.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50?d=identicon")]
    [InlineData("https://0.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50")]
    [InlineData("https://avatars.githubusercontent.com/u/9919?v=4")]
    [InlineData("https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://avatars.fastly.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://i.imgur.com/removed.png")]
    [InlineData("https://static-cdn.jtvnw.net/jtv_user_pictures/x-profile_image-300x300.png")]
    // Case is not part of a scheme or a host, so neither is held to it.
    [InlineData("HTTPS://I.IMGUR.COM/removed.png")]
    // After the host, an @ is only a character in the path.
    [InlineData("https://i.imgur.com/@someone.png")]
    public void AvatarUrlProblem_AnImageOnAListedHost_IsAccepted(string url) =>
        Assert.Null(AvatarUrlPolicy.Problem(url));

    [Theory]
    [InlineData("http://i.imgur.com/removed.png")]
    [InlineData("i.imgur.com/removed.png")]
    [InlineData("//i.imgur.com/removed.png")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    [InlineData("ftp://i.imgur.com/removed.png")]
    [InlineData("https://")]
    // Characters a URL does not carry unencoded — where two parsers stop agreeing.
    [InlineData("https://i.imgur.com/my avatar.png")]
    [InlineData("https://i.imgur.com\\@evil.example/x.png")]
    [InlineData("https://evil.example\\@i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com/\"onerror=\"x.png")]
    [InlineData("https://i.imgur.com/<x>.png")]
    [InlineData("https://i.imgur.com/avätar.png")]
    [InlineData("https://i.imgur.com/x.png\t")]
    public void AvatarUrlProblem_NotAnHttpsAddress_IsRefusedAsSuch(string url) =>
        Assert.Equal(
            "An avatar has to be the address of an image, starting https://.",
            AvatarUrlPolicy.Problem(url));

    [Theory]
    [InlineData("https://example.com/me.png")]
    [InlineData("https://my-own-server.example/pixel.png")]
    [InlineData("https://cdn.discordapp.com/embed/avatars/0.png")]
    [InlineData("https://imgur.com/removed.png")]
    [InlineData("https://gravatar.com.evil.example/avatar/x")]
    [InlineData("https://evil.example/i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com.evil.example/x.png")]
    [InlineData("https://i.imgur.com./removed.png")]
    [InlineData("https://127.0.0.1/avatar.png")]
    [InlineData("https://[::1]/avatar.png")]
    [InlineData("https://localhost/avatar.png")]
    // Credentials and ports in the authority match no host, whatever they wrap.
    [InlineData("https://i.imgur.com@evil.example/x.png")]
    [InlineData("https://user:pass@i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com:443/removed.png")]
    [InlineData("https://i.imgur.com:8443/removed.png")]
    public void AvatarUrlProblem_AHostNotOnTheList_IsRefusedNamingTheServices(string url) =>
        Assert.Equal(
            $"An avatar can come from {AvatarUrlPolicy.Services}.",
            AvatarUrlPolicy.Problem(url));

    [Fact]
    public void AvatarUrlProblem_UpToTheLimit_IsAccepted()
    {
        const string prefix = "https://i.imgur.com/";
        var url = prefix + new string('a', AvatarUrlPolicy.MaxLength - prefix.Length);

        Assert.Null(AvatarUrlPolicy.Problem(url));
    }

    [Fact]
    public void AvatarUrlProblem_OverTheLimit_IsRefused()
    {
        const string prefix = "https://i.imgur.com/";
        var url = prefix + new string('a', AvatarUrlPolicy.MaxLength - prefix.Length + 1);

        Assert.NotNull(AvatarUrlPolicy.Problem(url));
    }

    [Fact]
    public void AvatarUrlNormalise_KeepsTheAddressAsGiven()
    {
        // Stored as given: no lower-casing, no re-encoding, no rebuilt URL — only the whitespace a
        // paste brings with it is gone.
        Assert.Equal(
            "HTTPS://I.Imgur.com/Ab%20C.png?x=1#y",
            AvatarUrlPolicy.Normalise("  HTTPS://I.Imgur.com/Ab%20C.png?x=1#y \n"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AvatarUrlNormalise_Blank_IsNoAvatar(string? typed) =>
        Assert.Null(AvatarUrlPolicy.Normalise(typed));

    [Fact]
    public void AvatarUrlHosts_AreLowerCaseHostNamesAndEachListedOnce()
    {
        // The client's img-src is built from its own copy of this list, and a test there reads this
        // file to compare the two — a spelling either side would read differently is a host that is
        // saved and then never shown.
        Assert.All(AvatarUrlPolicy.Hosts, host =>
            Assert.Matches("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", host));
        Assert.Equal(AvatarUrlPolicy.Hosts.Count, AvatarUrlPolicy.Hosts.Distinct().Count());
    }

    // ── The request DTO ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The validation attributes on the DTO's constructor parameter, which is where MVC reads them —
    /// and where <c>Validator.TryValidateObject</c>, which reads properties, would not look.
    /// </summary>
    private static ValidationResult? Validate(string parameter, string? value)
    {
        var attribute = typeof(UpdateProfileDetailsDto).GetConstructors().Single().GetParameters()
            .Single(p => p.Name == parameter)
            .GetCustomAttributes<ValidationAttribute>()
            .Single();

        var context = new ValidationContext(new UpdateProfileDetailsDto(null, null, null))
        {
            MemberName = parameter,
        };

        return attribute.GetValidationResult(value, context);
    }

    [Theory]
    [InlineData(nameof(UpdateProfileDetailsDto.DisplayName))]
    [InlineData(nameof(UpdateProfileDetailsDto.AvatarUrl))]
    [InlineData(nameof(UpdateProfileDetailsDto.Bio))]
    public void UpdateProfileDetailsDto_NullOrBlank_IsAClearAndAccepted(string parameter)
    {
        Assert.Equal(ValidationResult.Success, Validate(parameter, null));
        Assert.Equal(ValidationResult.Success, Validate(parameter, "   "));
    }

    [Theory]
    [InlineData(nameof(UpdateProfileDetailsDto.DisplayName), "Alex\0")]
    [InlineData(nameof(UpdateProfileDetailsDto.AvatarUrl), "https://example.com/me.png")]
    [InlineData(nameof(UpdateProfileDetailsDto.Bio), "Bell \u0007")]
    public void UpdateProfileDetailsDto_ARefusal_IsKeyedByItsField(string parameter, string value)
    {
        var result = Validate(parameter, value);

        Assert.NotNull(result);
        // Keyed by the field, which is what puts the message beside its input on the form.
        Assert.Equal([parameter], result.MemberNames);
    }

    [Fact]
    public void UpdateProfileDetailsDto_JudgesTheStoredForm()
    {
        // Fifty characters with spaces around them is fifty characters once stored, so it passes;
        // what is refused is what would actually be too long.
        var padded = "  " + new string('a', DisplayNamePolicy.MaxLength) + "  ";

        Assert.Equal(ValidationResult.Success, Validate(nameof(UpdateProfileDetailsDto.DisplayName), padded));
    }

    // ── The columns ───────────────────────────────────────────────────────────────────

    [Fact]
    public void TheColumnsHoldWhatThePoliciesAllow()
    {
        using var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        // The design-time model: check constraints are migration metadata, which the read-optimised
        // runtime model does not keep.
        var users = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(ApplicationUser))!;

        Assert.Equal(DisplayNamePolicy.MaxLength, users.FindProperty(nameof(ApplicationUser.DisplayName))!.GetMaxLength());
        Assert.Equal(AvatarUrlPolicy.MaxLength, users.FindProperty(nameof(ApplicationUser.AvatarUrl))!.GetMaxLength());
        Assert.Equal(BioPolicy.MaxLength, users.FindProperty(nameof(ApplicationUser.Bio))!.GetMaxLength());

        var https = users.GetCheckConstraints().Single(c => c.ModelName == "CK_AspNetUsers_AvatarUrl_Https");
        Assert.Contains("'https://%'", https.Sql);
    }

    // ── The signed-in user's own profile ──────────────────────────────────────────────

    [Fact]
    public void UserProfileDto_For_CarriesWhatTheSettingsPageEdits()
    {
        var user = new ApplicationUser
        {
            Id = "user-1",
            Email = "alex@test.local",
            UserName = "alex",
            DisplayName = "Alex Smith",
            AvatarUrl = "https://i.imgur.com/removed.png",
            Bio = "Mostly RPGs.",
        };

        var profile = UserProfileDto.For(user, isAdmin: false);

        Assert.Equal("Alex Smith", profile.DisplayName);
        Assert.Equal("https://i.imgur.com/removed.png", profile.AvatarUrl);
        Assert.Equal("Mostly RPGs.", profile.Bio);
    }
}
