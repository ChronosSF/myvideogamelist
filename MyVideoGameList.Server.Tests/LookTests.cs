using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// An account's look as it is read back and as it is asked for (ADR 0082). The colour's shape is a
/// <see cref="RegularExpressionAttribute"/> on the record's parameter, which MVC runs as it binds a body
/// and <see cref="Validator"/> does not, so the integration suite's <c>LookFlowTests</c> covers that.
/// </summary>
public class LookTests
{
    [Theory]
    [InlineData("dark")]
    [InlineData("light")]
    [InlineData("retired")]
    public void LookDtoFor_ANameNoPaletteHas_IsTheDefaultPalette(string stored)
    {
        var look = LookDto.For(new ApplicationUser { Theme = stored }, canChoose: true);

        Assert.Equal(LookPolicy.DefaultPalette, look.Palette);
    }

    [Fact]
    public void LookDtoFor_APreset_CarriesNoColours()
    {
        // A row the check constraint would refuse, as InMemory lets it be: the colours of a custom
        // palette chosen before a preset are not the preset's.
        var look = LookDto.For(new ApplicationUser { Theme = "slate", ThemeBackground = "#101820", ThemeAccent = "#c8f560" }, canChoose: true);

        Assert.Equal(new LookDto("slate", null, null, LookPolicy.DefaultPattern, LookPolicy.DefaultTint), look);
    }

    [Fact]
    public void LookDtoFor_ACustomPalette_CarriesItsColours()
    {
        var look = LookDto.For(new ApplicationUser
        {
            Theme = LookPolicy.CustomPalette,
            ThemeBackground = "#101820",
            ThemeAccent = "#c8f560",
            BackgroundPattern = "pixels",
            PatternTint = "accent",
        }, canChoose: true);

        Assert.Equal(new LookDto(LookPolicy.CustomPalette, "#101820", "#c8f560", "pixels", "accent"), look);
    }

    [Fact]
    public void LookDtoFor_APatternOrTintNoLongerKnown_IsTheDefault()
    {
        var look = LookDto.For(new ApplicationUser { BackgroundPattern = "hexes", PatternTint = "lime" }, canChoose: true);

        Assert.Equal((LookPolicy.DefaultPattern, LookPolicy.DefaultTint), (look.Pattern, look.Tint));
    }

    [Fact]
    public void LookDtoFor_ANewAccount_IsTheDefaultLook()
    {
        Assert.Equal(
            new LookDto(LookPolicy.DefaultPalette, null, null, LookPolicy.DefaultPattern, LookPolicy.DefaultTint),
            LookDto.For(new ApplicationUser(), canChoose: true));
    }

    [Fact]
    public void LookDtoFor_AnAccountThatMayNotChoose_IsTheDefaultWhateverItChose()
    {
        var chose = new ApplicationUser
        {
            Theme = LookPolicy.CustomPalette,
            ThemeBackground = "#101820",
            ThemeAccent = "#c8f560",
            BackgroundPattern = "pixels",
            PatternTint = "accent",
        };

        Assert.Equal(LookDto.Default, LookDto.For(chose, canChoose: false));
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void CanChoose_AdminsOnlyForNow(bool isAdmin, bool expected)
    {
        Assert.Equal(expected, LookPolicy.CanChoose(isAdmin));
    }

    [Fact]
    public void UserProfileDtoFor_SaysWhetherTheAccountMayChoose_AndDrawsItAccordingly()
    {
        var user = new ApplicationUser { Email = "a@test.local", UserName = "a", Theme = "plum" };

        var admin = UserProfileDto.For(user, isAdmin: true);
        var member = UserProfileDto.For(user, isAdmin: false);

        Assert.Equal((true, "plum"), (admin.CanChooseLook, admin.Look.Palette));
        Assert.Equal((false, LookPolicy.DefaultPalette), (member.CanChooseLook, member.Look.Palette));
    }

    [Fact]
    public void UpdateLookDto_EveryPresetAndPattern_IsValid()
    {
        foreach (var palette in LookPolicy.Palettes.Where(p => p != LookPolicy.CustomPalette))
            foreach (var pattern in LookPolicy.Patterns)
                foreach (var tint in LookPolicy.Tints)
                    Assert.Empty(Problems(new UpdateLookDto(palette, null, null, pattern, tint)));
    }

    [Fact]
    public void UpdateLookDto_ACustomPaletteWithBothColours_IsValid()
    {
        Assert.Empty(Problems(new UpdateLookDto(LookPolicy.CustomPalette, "#101820", "#C8F560", "none", "accent")));
    }

    [Theory]
    [InlineData(null, "#c8f560")]
    [InlineData("#101820", null)]
    [InlineData(null, null)]
    public void UpdateLookDto_ACustomPaletteMissingAColour_IsRefusedOnBoth(string? background, string? accent)
    {
        var problem = Assert.Single(Problems(new UpdateLookDto(LookPolicy.CustomPalette, background, accent, "none", "grey")));

        Assert.Equal([nameof(UpdateLookDto.Background), nameof(UpdateLookDto.Accent)], problem.MemberNames);
    }

    [Fact]
    public void UpdateLookDto_NamesTheSiteDoesNotKnow_AreRefusedEachByItsField()
    {
        var problems = Problems(new UpdateLookDto("dark", null, null, "hexes", "lime"));

        Assert.Equal(
            [nameof(UpdateLookDto.Palette), nameof(UpdateLookDto.Pattern), nameof(UpdateLookDto.Tint)],
            problems.Select(p => Assert.Single(p.MemberNames)));
    }

    private static List<ValidationResult> Problems(UpdateLookDto dto)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results;
    }
}
