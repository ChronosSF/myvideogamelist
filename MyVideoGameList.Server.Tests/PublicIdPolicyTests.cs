using System.Text.RegularExpressions;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a profile's public id is, and that the database's check and the application's say the same
/// thing about it (ADR 0096).
/// </summary>
public class PublicIdPolicyTests
{
    [Fact]
    public void New_EveryDraw_IsWellFormed()
    {
        for (var i = 0; i < 1000; i++)
        {
            var id = PublicIdPolicy.New();
            Assert.True(PublicIdPolicy.IsWellFormed(id), id);
        }
    }

    [Fact]
    public void New_TenThousandDraws_AreTenThousandIds()
    {
        // Not a proof of randomness, which no test gives, but a generator that repeats in ten thousand
        // draws out of 30^12 is broken, and this is where it would show.
        var drawn = Enumerable.Range(0, 10_000).Select(_ => PublicIdPolicy.New()).ToHashSet();

        Assert.Equal(10_000, drawn.Count);
    }

    [Fact]
    public void Alphabet_IsThirtySymbolsWithNoVowelAndNoL()
    {
        Assert.Equal(30, PublicIdPolicy.Alphabet.Distinct().Count());
        Assert.Equal(PublicIdPolicy.Alphabet.Length, PublicIdPolicy.Alphabet.Distinct().Count());
        Assert.DoesNotContain(PublicIdPolicy.Alphabet, c => "aeioul".Contains(c));
        Assert.All(PublicIdPolicy.Alphabet, c => Assert.True(char.IsAsciiDigit(c) || char.IsAsciiLetterLower(c)));
    }

    [Theory]
    [InlineData("b4kz9q2mxw7c", true)]
    [InlineData("000000000000", true)]
    [InlineData("zzzzzzzzzzzz", true)]
    [InlineData("b4kz9q2mxw7", false)]
    [InlineData("b4kz9q2mxw7cc", false)]
    [InlineData("B4KZ9Q2MXW7C", false)]
    [InlineData("b4kz9q2mxw7a", false)]
    [InlineData("b4kz9q2mxw7l", false)]
    [InlineData("b4kz9q2mxw7-", false)]
    [InlineData("alice_2", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsWellFormed_AndTheDatabaseCheck_AgreeOnEveryCase(string? value, bool wellFormed)
    {
        Assert.Equal(wellFormed, PublicIdPolicy.IsWellFormed(value));
        if (value is not null) Assert.Equal(wellFormed, MatchesTheCheck(value));
    }

    /// <summary>
    /// The pattern the column's check constraint carries, run here as .NET reads it. The two dialects
    /// agree on a bracket of plain characters and a bounded repeat, which is all the pattern is.
    /// </summary>
    private static bool MatchesTheCheck(string value)
    {
        var check = Regex.Match(PublicIdPolicy.CheckConstraintSql, "~ '(.*)'$");
        Assert.True(check.Success, PublicIdPolicy.CheckConstraintSql);
        return Regex.IsMatch(value, check.Groups[1].Value);
    }
}
