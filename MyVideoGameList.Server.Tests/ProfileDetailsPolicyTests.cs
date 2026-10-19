using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.ModelBinding.Validation;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
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
/// <c>docs/decisions/0056-*</c>. Characters nobody can see are written as code points, never typed
/// into the source.
/// </remarks>
public class ProfileDetailsPolicyTests
{
    private const string NotAnAddress = "An avatar has to be the address of a picture, starting https://.";

    private static readonly string NotAListedHost =
        $"An avatar has to be a picture's own address on {AvatarUrlPolicy.Services}: right-click the "
        + "picture there and copy the image address.";

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
        Assert.Equal(
            "A display name can be at most 50 characters.",
            DisplayNamePolicy.Problem(new string('a', DisplayNamePolicy.MaxLength + 1)));

    [Theory]
    [InlineData(0x00)] // NUL
    [InlineData(0x07)] // bell
    [InlineData(0x1B)] // escape
    [InlineData(0x7F)] // delete
    public void DisplayNameProblem_ControlCharacter_IsRefused(int codePoint) =>
        Assert.Equal(
            "A display name cannot contain control characters.",
            DisplayNamePolicy.Problem(DisplayNamePolicy.Normalise("Alex" + (char)codePoint + "Smith")!));

    [Theory]
    [InlineData("Alex @ChronosSF")]
    [InlineData("Stamen (@ChronosSF)")]
    [InlineData("alex@example.com")]
    public void DisplayNameProblem_AnAtSign_IsRefused(string typed) =>
        // A handle is written "@carol" everywhere, so a name holding one could pass for somebody
        // else's beside the real one.
        Assert.Equal(
            "A display name cannot contain @, which is how a username is written here.",
            DisplayNamePolicy.Problem(DisplayNamePolicy.Normalise(typed)!));

    [Theory]
    [InlineData(0x202A)] // left-to-right embedding, the range's first
    [InlineData(0x202D)] // left-to-right override
    [InlineData(0x202E)] // right-to-left override, the range's last
    [InlineData(0x2066)] // left-to-right isolate, the second range's first
    [InlineData(0x2067)] // right-to-left isolate
    [InlineData(0x2069)] // the isolate closer, the second range's last
    public void DisplayNameProblem_DirectionalFormatting_IsRefused(int codePoint) =>
        // An unclosed override in "carol (Name)" reverses whatever follows it in a title.
        Assert.Equal(
            "A display name cannot contain characters that change the direction of the text around it.",
            DisplayNamePolicy.Problem("Alex" + (char)codePoint));

    [Theory]
    [InlineData(0x2029)] // just below the second range
    [InlineData(0x206A)] // just above it
    [InlineData(0x200F)] // the right-to-left mark, which only nudges its neighbours
    [InlineData(0x200D)] // the zero-width joiner, which is how emoji compose
    public void DisplayNameProblem_FormattingThatReordersNothing_IsAccepted(int codePoint) =>
        Assert.Null(DisplayNamePolicy.Problem("Alex" + (char)codePoint));

    [Theory]
    [InlineData("دانيال")] // a right-to-left script needs no override to lay itself out
    [InlineData("Ana-María O'Neil")]
    [InlineData("The Witcher's #1 fan")]
    // Not a namespace, so the words a username's reserved list refuses are fine: the handle beside it
    // says whose account this is (ADR 0027).
    [InlineData("admin")]
    public void DisplayNameProblem_OrdinaryNames_AreAccepted(string typed) =>
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
    [InlineData("One\n\n\nTwo", "One\n\nTwo")]
    [InlineData("One\n \n\t\n  \nTwo", "One\n\nTwo")]
    [InlineData("One\r\n\r\n\r\n\r\nTwo", "One\n\nTwo")]
    public void BioNormalise_ARunOfBlankLines_IsOneBlankLine(string typed, string stored) =>
        // Five hundred line breaks would otherwise push the figures a screen-height down.
        Assert.Equal(stored, BioPolicy.Normalise(typed));

    [Fact]
    public void BioNormalise_AnIndentAfterABlankLine_IsKept() =>
        Assert.Equal("One\n\n    Two", BioPolicy.Normalise("One\n\n\n\n    Two"));

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
        Assert.Equal(
            "A bio can be at most 500 characters.",
            BioPolicy.Problem(new string('a', BioPolicy.MaxLength + 1)));

    [Fact]
    public void BioProblem_LineBreaksSentAsCrLf_CountOnce()
    {
        // 250 lines of one character: 499 characters stored, but 748 as a browser posting a form
        // would send them. The limit is on what is stored.
        var typed = string.Join("\r\n", Enumerable.Repeat("a", 250));

        Assert.Null(BioPolicy.Problem(BioPolicy.Normalise(typed)!));
    }

    [Fact]
    public void BioProblem_ATabAndALineBreak_AreText() =>
        Assert.Null(BioPolicy.Problem("Name:\tAlex\nPlays:\tRPGs"));

    [Theory]
    [InlineData(0x00)] // NUL
    [InlineData(0x07)] // bell
    [InlineData(0x1B)] // escape, as an ANSI colour code starts
    [InlineData(0x0C)] // form feed
    public void BioProblem_ControlCharacterOtherThanALineBreakOrTab_IsRefused(int codePoint) =>
        Assert.Equal(
            "A bio can contain line breaks and tabs, but no other control characters.",
            BioPolicy.Problem(BioPolicy.Normalise("Hello " + (char)codePoint + " there")!));

    [Theory]
    // Plain text is how it is rendered, not what is refused: none of these is markup on the page.
    [InlineData("<b>bold</b> and <script>alert(1)</script>")]
    [InlineData("I <3 RPGs, and 2 < 3")]
    [InlineData("**not bold** [not a link](https://example.com)")]
    [InlineData("Find me @ChronosSF")]
    public void BioProblem_TextThatLooksLikeMarkup_IsAccepted(string typed) =>
        Assert.Null(BioPolicy.Problem(BioPolicy.Normalise(typed)!));

    // ── Avatar ────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50?s=200")]
    [InlineData("https://www.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50?s=200&d=identicon")]
    [InlineData("https://secure.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50?d=mp")]
    [InlineData("https://0.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50")]
    [InlineData("https://avatars.githubusercontent.com/u/9919?v=4")]
    [InlineData("https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://avatars.fastly.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://i.imgur.com/removed.png")]
    // A percent-encoded character and a fragment are ordinary parts of an address.
    [InlineData("https://i.imgur.com/Ab%20C.png#top")]
    // Case is not part of a scheme or a host, so neither is held to it.
    [InlineData("HTTPS://I.IMGUR.COM/removed.png")]
    // After the host, an @ is only a character in the path.
    [InlineData("https://i.imgur.com/@someone.png")]
    public void AvatarUrlProblem_APictureOnAListedHost_IsAccepted(string url) =>
        Assert.Null(AvatarUrlPolicy.Problem(url));

    [Theory]
    [InlineData("http://i.imgur.com/removed.png")]
    [InlineData("i.imgur.com/removed.png")]
    [InlineData("//i.imgur.com/removed.png")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    [InlineData("ftp://i.imgur.com/removed.png")]
    [InlineData("https://")]
    // Characters an address from these hosts never needs — where two parsers stop agreeing, or where
    // the address could break out of an attribute or a CSS url() if it were ever written into one.
    [InlineData("https://i.imgur.com/my avatar.png")]
    [InlineData("https://i.imgur.com\\@evil.example/x.png")]
    [InlineData("https://evil.example\\@i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com/\"onerror=\"x.png")]
    [InlineData("https://i.imgur.com/<x>.png")]
    [InlineData("https://i.imgur.com/x.png);position:fixed;inset:0")]
    [InlineData("https://i.imgur.com/it's.png")]
    [InlineData("https://[::1]/avatar.png")]
    [InlineData("https://i.imgur.com/avätar.png")]
    // An internationalised host: the ASCII rule refuses it before any parser can disagree about it.
    [InlineData("https://i.ımgur.com/removed.png")]
    [InlineData("https://i.imgur.com/x.png\t")]
    public void AvatarUrlProblem_NotAnHttpsAddress_IsRefusedAsSuch(string url) =>
        Assert.Equal(NotAnAddress, AvatarUrlPolicy.Problem(url));

    [Theory]
    [InlineData("https://example.com/me.png")]
    [InlineData("https://my-own-server.example/pixel.png")]
    [InlineData("https://cdn.discordapp.com/embed/avatars/0.png")]
    [InlineData("https://static-cdn.jtvnw.net/jtv_user_pictures/x-profile_image-300x300.png")]
    [InlineData("https://github.com/ChronosSF.png")]
    [InlineData("https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg")]
    [InlineData("https://imgur.com/removed.png")]
    // Matched exactly, never by what a host ends or begins with.
    [InlineData("https://notgravatar.com/avatar/x")]
    [InlineData("https://3.gravatar.com/avatar/x")]
    [InlineData("https://evil.i.imgur.com/x.png")]
    [InlineData("https://gravatar.com.evil.example/avatar/x")]
    [InlineData("https://evil.example/i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com.evil.example/x.png")]
    [InlineData("https://i.imgur.com./removed.png")]
    [InlineData("https://127.0.0.1/avatar.png")]
    [InlineData("https://localhost/avatar.png")]
    // Credentials and ports in the authority match no host, whatever they wrap.
    [InlineData("https://i.imgur.com@evil.example/x.png")]
    [InlineData("https://user:pass@i.imgur.com/x.png")]
    [InlineData("https://i.imgur.com:443/removed.png")]
    [InlineData("https://i.imgur.com:8443/removed.png")]
    public void AvatarUrlProblem_AHostNotOnTheList_IsRefusedNamingTheServices(string url) =>
        Assert.Equal(NotAListedHost, AvatarUrlPolicy.Problem(url));

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

        Assert.Equal("An avatar's address can be at most 512 characters.", AvatarUrlPolicy.Problem(url));
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

    // ── The request DTO, one attribute at a time ──────────────────────────────────────

    /// <summary>
    /// The validation attribute on the DTO's constructor parameter, which is where MVC reads it —
    /// and where <c>Validator.TryValidateObject</c>, which reads properties, would not look.
    /// </summary>
    private static ValidationResult? ValidateParameter(string parameter, string? value)
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

    public static TheoryData<string, string> WhatEachFieldAccepts() => new()
    {
        // The name is one the avatar's policy refuses, and the bio one both the others refuse. With
        // the refusals below, an attribute on the wrong parameter fails one test or the other.
        { nameof(UpdateProfileDetailsDto.DisplayName), "Alex Smith" },
        { nameof(UpdateProfileDetailsDto.AvatarUrl), "https://i.imgur.com/removed.png" },
        { nameof(UpdateProfileDetailsDto.Bio), "Mostly RPGs, slowly, and never on a weekday.\n\n@ me." },
    };

    [Theory]
    [MemberData(nameof(WhatEachFieldAccepts))]
    public void UpdateProfileDetailsDto_WhatItsOwnPolicyAccepts_IsAccepted(string parameter, string value) =>
        Assert.Equal(ValidationResult.Success, ValidateParameter(parameter, value));

    [Theory]
    [InlineData(nameof(UpdateProfileDetailsDto.DisplayName))]
    [InlineData(nameof(UpdateProfileDetailsDto.AvatarUrl))]
    [InlineData(nameof(UpdateProfileDetailsDto.Bio))]
    public void UpdateProfileDetailsDto_NullOrBlank_IsAClearAndAccepted(string parameter)
    {
        Assert.Equal(ValidationResult.Success, ValidateParameter(parameter, null));
        Assert.Equal(ValidationResult.Success, ValidateParameter(parameter, "   "));
    }

    [Fact]
    public void UpdateProfileDetailsDto_ARefusal_SaysWhatItsPolicySays()
    {
        // Each value is refused by its own policy alone, and the sentence is the policy's own: a
        // validator on the wrong parameter, or one answering the framework's "The field is invalid",
        // fails here.
        Assert.Equal(
            DisplayNamePolicy.Problem(new string('a', 51)),
            ValidateParameter(nameof(UpdateProfileDetailsDto.DisplayName), new string('a', 51))?.ErrorMessage);
        Assert.Equal(
            AvatarUrlPolicy.Problem("https://example.com/me.png"),
            ValidateParameter(nameof(UpdateProfileDetailsDto.AvatarUrl), "https://example.com/me.png")?.ErrorMessage);
        Assert.Equal(
            BioPolicy.Problem(new string('a', 501)),
            ValidateParameter(nameof(UpdateProfileDetailsDto.Bio), new string('a', 501))?.ErrorMessage);
    }

    [Fact]
    public void UpdateProfileDetailsDto_JudgesTheStoredForm()
    {
        // Fifty characters with spaces around them is fifty characters once stored, so it passes;
        // what is refused is what would actually be too long.
        var padded = "  " + new string('a', DisplayNamePolicy.MaxLength) + "  ";

        Assert.Equal(ValidationResult.Success, ValidateParameter(nameof(UpdateProfileDetailsDto.DisplayName), padded));
    }

    // ── The request DTO, as MVC validates it ──────────────────────────────────────────

    /// <summary>
    /// The model state MVC's own validator leaves for a body, which is what <c>[ApiController]</c>
    /// turns into the 400's <c>errors</c>. Under the empty prefix a <c>[FromBody]</c> parameter binds
    /// with, so the keys are the ones a client receives.
    /// </summary>
    private static ModelStateDictionary ValidateAsMvcDoes(UpdateProfileDetailsDto dto)
    {
        using var services = new ServiceCollection().AddLogging().AddControllers().Services.BuildServiceProvider();
        var validator = services.GetRequiredService<IObjectModelValidator>();
        var actionContext = new ActionContext(
            new DefaultHttpContext { RequestServices = services },
            new RouteData(),
            new ActionDescriptor());

        validator.Validate(actionContext, validationState: null, prefix: string.Empty, model: dto);
        return actionContext.ModelState;
    }

    [Fact]
    public void UpdateProfileDetailsDto_AsMvcValidatesIt_KeysEachRefusalByItsField()
    {
        var state = ValidateAsMvcDoes(new UpdateProfileDetailsDto(
            new string('a', 51), "https://example.com/me.png", "Bell " + (char)7));

        var errors = new ValidationProblemDetails(state).Errors;

        Assert.Equal(
            ["AvatarUrl", "Bio", "DisplayName"],
            errors.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(DisplayNamePolicy.Problem(new string('a', 51)), Assert.Single(errors["DisplayName"]));
        Assert.Equal(AvatarUrlPolicy.Problem("https://example.com/me.png"), Assert.Single(errors["AvatarUrl"]));
        Assert.Equal(BioPolicy.Problem("Bell " + (char)7), Assert.Single(errors["Bio"]));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void UpdateProfileDetailsDto_AsMvcValidatesIt_AcceptsEveryFieldCleared(string? blank)
    {
        // Each parameter is nullable, so MVC adds no implicit [Required]: drop a `?` and clearing a
        // field becomes "The field is required", which this would catch and the attribute tests
        // above would not.
        Assert.True(ValidateAsMvcDoes(new UpdateProfileDetailsDto(blank, blank, blank)).IsValid);
    }

    // ── The columns ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ApplicationUserModel_ProfileDetailColumns_HoldWhatThePoliciesAllow()
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

        // ILIKE, not LIKE: the address is stored as given, so "HTTPS://" has to satisfy it too.
        var https = users.GetCheckConstraints().Single(c => c.ModelName == "CK_AspNetUsers_AvatarUrl_Https");
        Assert.Equal("\"AvatarUrl\" IS NULL OR \"AvatarUrl\" ILIKE 'https://%'", https.Sql);
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
