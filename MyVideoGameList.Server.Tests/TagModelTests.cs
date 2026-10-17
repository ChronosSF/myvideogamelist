using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The shape of the two tag tables, and the rules a tag's name answers to.
/// </summary>
/// <remarks>
/// The keys are asserted on the <em>model</em> because the in-memory provider the other tests run on
/// enforces none of them: a duplicate name, a link to somebody else's tag and an orphaned link all
/// succeed there. The constraints themselves were verified by reading the migration's SQL, which is
/// what its comment asks the next person to do again (ADR 0065).
/// </remarks>
public class TagModelTests
{
    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    // ---------------------------------------------------------------- the model

    [Fact]
    public void Tag_IsUniquePerAccountByItsFoldedName()
    {
        // Over the folded column and not the name, so two spellings of one word cannot both get in.
        using var db = NewDb();

        var indexes = db.Model.FindEntityType(typeof(Tag))!.GetIndexes();

        Assert.Contains(indexes, index =>
            index.IsUnique
            && index.Properties.Select(p => p.Name)
                .SequenceEqual([nameof(Tag.UserId), nameof(Tag.NormalizedName)]));
        Assert.DoesNotContain(indexes, index =>
            index.IsUnique && index.Properties.Any(p => p.Name == nameof(Tag.Name)));
    }

    [Fact]
    public void Tag_CarriesAnAlternateKeyForItsLinks()
    {
        using var db = NewDb();

        var keys = db.Model.FindEntityType(typeof(Tag))!.GetKeys();

        Assert.Contains(keys, key =>
            !key.IsPrimaryKey()
            && key.Properties.Select(p => p.Name).SequenceEqual([nameof(Tag.Id), nameof(Tag.UserId)]));
    }

    [Fact]
    public void Tag_NameColumns_HoldExactlyWhatThePolicyAllows()
    {
        // A name the policy passes has to fit the column, or a valid tag is a 500.
        using var db = NewDb();
        var tag = db.Model.FindEntityType(typeof(Tag))!;

        Assert.Equal(TagNamePolicy.MaxLength, tag.FindProperty(nameof(Tag.Name))!.GetMaxLength());
        Assert.Equal(TagNamePolicy.MaxLength, tag.FindProperty(nameof(Tag.NormalizedName))!.GetMaxLength());
    }

    [Fact]
    public void UserGameEntryTag_IsKeyedOnTheGameAndTheTag()
    {
        // A tag is on a game once or not at all.
        using var db = NewDb();

        var key = db.Model.FindEntityType(typeof(UserGameEntryTag))!.FindPrimaryKey()!;

        Assert.Equal(
            [nameof(UserGameEntryTag.UserGameEntryId), nameof(UserGameEntryTag.TagId)],
            key.Properties.Select(p => p.Name));
    }

    [Fact]
    public void UserGameEntryTag_ReachesItsEntryThroughBothIdAndOwner()
    {
        using var db = NewDb();

        var foreignKeys = db.Model.FindEntityType(typeof(UserGameEntryTag))!.GetForeignKeys();

        Assert.Contains(foreignKeys, fk =>
            fk.PrincipalEntityType.ClrType == typeof(UserGameEntry)
            && fk.DeleteBehavior == DeleteBehavior.Cascade
            && fk.Properties.Select(p => p.Name).SequenceEqual(
                [nameof(UserGameEntryTag.UserGameEntryId), nameof(UserGameEntryTag.UserId)])
            && fk.PrincipalKey.Properties.Select(p => p.Name).SequenceEqual(
                [nameof(UserGameEntry.Id), nameof(UserGameEntry.UserId)]));
    }

    [Fact]
    public void UserGameEntryTag_ReachesItsTagThroughBothIdAndOwner()
    {
        // The half that makes "one account's game carries only that account's tags" a constraint: the tag
        // is referenced by (Id, UserId), and the UserId is the link's own — the same column the entry's
        // key uses.
        using var db = NewDb();

        var foreignKeys = db.Model.FindEntityType(typeof(UserGameEntryTag))!.GetForeignKeys();

        Assert.Contains(foreignKeys, fk =>
            fk.PrincipalEntityType.ClrType == typeof(Tag)
            && fk.DeleteBehavior == DeleteBehavior.Cascade
            && fk.Properties.Select(p => p.Name).SequenceEqual(
                [nameof(UserGameEntryTag.TagId), nameof(UserGameEntryTag.UserId)])
            && fk.PrincipalKey.Properties.Select(p => p.Name).SequenceEqual(
                [nameof(Tag.Id), nameof(Tag.UserId)]));
    }

    // ---------------------------------------------------------------- the name

    [Theory]
    [InlineData("  co-op  ", "co-op")]
    [InlineData("couch   co-op", "couch co-op")]
    [InlineData("couch\tco-op", "couch co-op")]
    [InlineData("couch\nco-op", "couch co-op")]
    [InlineData("couch co-op", "couch co-op")]
    [InlineData("café", "café")]
    public void Normalise_TidiesWhatSomebodyTyped(string typed, string stored) =>
        Assert.Equal(stored, TagNamePolicy.Normalise(typed));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \t ")]
    public void Normalise_NothingButWhitespace_IsNoName(string? typed) =>
        Assert.Null(TagNamePolicy.Normalise(typed));

    [Fact]
    public void Normalise_ALoneSurrogate_IsPassedThroughForProblemToRefuse()
    {
        // string.Normalize throws on one, and JSON can carry one; a 500 for a malformed name would be the
        // wrong answer to a malformed request.
        var name = TagNamePolicy.Normalise("half \ud800");

        Assert.NotNull(name);
        Assert.NotNull(TagNamePolicy.Problem(name));
    }

    [Fact]
    public void Problem_AllowsExactlyTheMaximumLength()
    {
        Assert.Null(TagNamePolicy.Problem(new string('a', TagNamePolicy.MaxLength)));
        Assert.Equal(
            $"A tag can be at most {TagNamePolicy.MaxLength} characters.",
            TagNamePolicy.Problem(new string('a', TagNamePolicy.MaxLength + 1)));
    }

    [Theory]
    [InlineData("100%")]
    [InlineData("with Sam & Alex")]
    [InlineData("🎮 couch")]
    public void Problem_AllowsPunctuationAndEmoji(string name) =>
        Assert.Null(TagNamePolicy.Problem(name));

    [Fact]
    public void Problem_RefusesAControlCharacter() =>
        Assert.NotNull(TagNamePolicy.Problem("bell\u0007"));

    [Fact]
    public void Key_FoldsLetterCase() =>
        Assert.Equal(TagNamePolicy.Key("Co-Op"), TagNamePolicy.Key("cO-oP"));

    // ---------------------------------------------------------------- the request

    /// <summary>
    /// The validation attributes on a record's constructor parameter, which is where MVC reads them and
    /// where <c>Validator.TryValidateObject</c>, which reads properties, would not look.
    /// </summary>
    private static ValidationAttribute[] AttributesOf<TDto>(string parameter) =>
        typeof(TDto).GetConstructors().Single().GetParameters()
            .Single(p => p.Name == parameter)
            .GetCustomAttributes<ValidationAttribute>()
            .ToArray();

    private static string? FirstError<TDto>(string parameter, object? value) =>
        AttributesOf<TDto>(parameter)
            .Select(attribute => attribute.GetValidationResult(value, new ValidationContext(new object()) { MemberName = parameter }))
            .FirstOrDefault(result => result != ValidationResult.Success)
            ?.ErrorMessage;

    [Theory]
    [InlineData("co-op")]
    [InlineData("  co-op  ")]
    [InlineData("a name of exactly thirty chars")]
    public void TagNameDto_AcceptsAName(string name) =>
        Assert.Null(FirstError<TagNameDto>(nameof(TagNameDto.Name), name));

    [Theory]
    [InlineData("", "The Name field is required.")]
    [InlineData("   ", "The Name field is required.")]
    [InlineData("a name of thirty-one characters", "A tag can be at most 30 characters.")]
    public void TagNameDto_RefusesWhatThePolicyRefuses(string name, string message) =>
        Assert.Equal(message, FirstError<TagNameDto>(nameof(TagNameDto.Name), name));

    [Fact]
    public void ValidTagName_RefusesAHugeNameWithoutReadingIt() =>
        Assert.Equal(
            $"A tag can be at most {TagNamePolicy.MaxLength} characters.",
            ValidTagNameAttribute.Check(new string(' ', TagNamePolicy.MaxRawLength) + "x"));

    [Fact]
    public void SetEntryTagsDto_AllowsUpToTheCapAndNoMore()
    {
        Assert.Null(FirstError<SetEntryTagsDto>(
            nameof(SetEntryTagsDto.TagIds), Enumerable.Range(1, TagNamePolicy.MaxTagsPerEntry).ToList()));
        Assert.Null(FirstError<SetEntryTagsDto>(nameof(SetEntryTagsDto.TagIds), new List<int>()));
        Assert.Equal(
            $"A game can carry at most {TagNamePolicy.MaxTagsPerEntry} tags.",
            FirstError<SetEntryTagsDto>(
                nameof(SetEntryTagsDto.TagIds), Enumerable.Range(1, TagNamePolicy.MaxTagsPerEntry + 1).ToList()));
    }

    [Fact]
    public void SetEntryTagsDto_RequiresTheList() =>
        Assert.NotNull(FirstError<SetEntryTagsDto>(nameof(SetEntryTagsDto.TagIds), null));
}
