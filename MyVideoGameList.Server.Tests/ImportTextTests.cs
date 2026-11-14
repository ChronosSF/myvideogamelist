using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

public class ImportTextTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("  Played  ", "Played")]
    public void Clean_AValue_IsTrimmedOrNullWhenBlank(string? value, string? expected) =>
        Assert.Equal(expected, ImportText.Clean(value));

    [Fact]
    public void Truncate_AValueThatFits_IsUnchanged() =>
        Assert.Equal("Hades", ImportText.Truncate("Hades", 5));

    [Fact]
    public void Truncate_ACutThroughASurrogatePair_DropsTheWholeCharacter()
    {
        // "ab" and then 🎮, two units: a cut at three would keep only its first half.
        var cut = ImportText.Truncate("ab\U0001F3AEcd", 3);

        Assert.Equal("ab", cut);
    }

    [Fact]
    public void Truncate_ACutAfterASurrogatePair_KeepsIt() =>
        Assert.Equal("ab\U0001F3AE", ImportText.Truncate("ab\U0001F3AEcd", 4));

    [Fact]
    public void TruncateMarked_AValueThatFits_HasNoEllipsis() =>
        Assert.Equal("Loved it", ImportText.TruncateMarked("Loved it", 8));

    [Fact]
    public void TruncateMarked_AValueCut_EndsInAnEllipsisWithinTheLength()
    {
        var cut = ImportText.TruncateMarked(new string('a', 2500), 2000);

        Assert.Equal(2000, cut.Length);
        Assert.Equal(new string('a', 1999) + "…", cut);
    }

    [Fact]
    public void TruncateMarked_ACutThroughASurrogatePair_LeavesNoHalfOfIt()
    {
        // The ellipsis takes the fifth unit, so the cut before it lands inside 🎮.
        var cut = ImportText.TruncateMarked("abc\U0001F3AEdef", 5);

        Assert.Equal("abc…", cut);
        Assert.DoesNotContain(cut, char.IsSurrogate);
    }
}
