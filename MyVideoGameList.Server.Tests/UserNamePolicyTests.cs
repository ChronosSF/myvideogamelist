using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What may be a username, and what may not.
/// </summary>
/// <remarks>
/// These are the rules that decide what can appear in a URL and what one account can call itself in
/// front of another, so they are pinned rather than left to be re-derived from the implementation.
/// Availability is not tested here because the policy does not answer it — that is the database's
/// unique index, exercised through <c>UserController</c>.
/// </remarks>
public class UserNamePolicyTests
{
    [Theory]
    [InlineData("alex")]
    [InlineData("Alex")]
    [InlineData("ALEX")]
    [InlineData("abc")]
    [InlineData("a_b")]
    [InlineData("player_1")]
    [InlineData("12345")]
    [InlineData("____")]
    [InlineData("twentycharactersxxxx")]
    public void Check_WellFormedName_IsOk(string userName) =>
        Assert.Equal(UserNamePolicy.Result.Ok, UserNamePolicy.Check(userName));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ab")]
    [InlineData("twentyonecharactersxx")]
    // Everything Identity's *default* alphabet would have allowed, and this one does not: a
    // username that looks like an email address is the exact confusion the split was made to end.
    [InlineData("alex@example.com")]
    [InlineData("alex.smith")]
    [InlineData("alex-smith")]
    [InlineData("alex+1")]
    // A space would survive a URL and read as two names; the rest are path and query characters
    // that would need escaping to appear in one.
    [InlineData("alex smith")]
    [InlineData("alex/smith")]
    [InlineData("alex?x=1")]
    [InlineData("álex")]
    public void Check_MalformedName_IsMalformed(string? userName) =>
        Assert.Equal(UserNamePolicy.Result.Malformed, UserNamePolicy.Check(userName));

    [Theory]
    [InlineData("admin")]
    [InlineData("support")]
    [InlineData("games")]
    [InlineData("api")]
    [InlineData("myvideogamelist")]
    public void Check_ReservedName_IsReserved(string userName) =>
        Assert.Equal(UserNamePolicy.Result.Reserved, UserNamePolicy.Check(userName));

    [Theory]
    [InlineData("Admin")]
    [InlineData("ADMIN")]
    [InlineData("SuPPoRt")]
    public void Check_ReservedNameInAnyCase_IsStillReserved(string userName)
    {
        // The namespace is case-insensitive, so a reserved list that were not would reserve
        // nothing at all: `Admin` would be free and would resolve to the same profile as `admin`.
        Assert.Equal(UserNamePolicy.Result.Reserved, UserNamePolicy.Check(userName));
    }

    [Fact]
    public void AllowedCharacters_MatchesWhatCheckAccepts()
    {
        // Identity's own validator is configured from AllowedCharacters, and Check reads the same
        // string. This pins the pair: a character allowed by one and refused by the other is a name
        // that either cannot be registered or can be registered only by bypassing the policy.
        foreach (var character in UserNamePolicy.AllowedCharacters)
        {
            var name = new string(character, UserNamePolicy.MinLength);
            Assert.Equal(UserNamePolicy.Result.Ok, UserNamePolicy.Check(name));
        }
    }

    [Fact]
    public void Message_ForOk_IsEmpty()
    {
        // Nothing to tell the user when nothing is wrong — a non-empty string here would end up
        // rendered under a field that was accepted.
        Assert.Equal(string.Empty, UserNamePolicy.Message(UserNamePolicy.Result.Ok));
    }

    [Theory]
    [InlineData(UserNamePolicy.Result.Malformed)]
    [InlineData(UserNamePolicy.Result.Reserved)]
    public void Message_ForRefusal_SaysSomething(UserNamePolicy.Result result) =>
        Assert.False(string.IsNullOrWhiteSpace(UserNamePolicy.Message(result)));
}
