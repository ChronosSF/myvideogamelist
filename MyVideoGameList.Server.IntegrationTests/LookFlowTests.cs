using System.Net;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// An account's look, from the settings page's save to the profile every page reads, through the real
/// pipeline and PostgreSQL's columns and check constraints (ADR 0082).
/// </summary>
/// <remarks>
/// Only an admin may choose a look for now (ADR 0082 §8), so each test that saves one names its account
/// first. What only this suite can show: the colour's shape is a <see cref="System.ComponentModel.DataAnnotations.RegularExpressionAttribute"/>
/// on the record's parameter, which runs as MVC binds a real body, and the constraints hold the row to a
/// name the stylesheet knows and to colours that are there exactly when the palette is custom.
/// </remarks>
public class LookFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task UpdateLook_ACustomPalette_IsStoredInLowerCaseAndReadBackOnTheProfile()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("looker"));
        Assert.Equal(new LookDto("ink", null, null, "honeycomb", "grey"), account.Look);
        api.Admins.Name(account.Id);

        var saved = await (await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("custom", "#10182A", "#C8F560", "perspective", "accent")))
            .ReadAsync<UserProfileDto>(HttpStatusCode.OK);

        var expected = new LookDto("custom", "#10182a", "#c8f560", "perspective", "accent");
        Assert.Equal(expected, saved.Look);
        Assert.Equal(expected, (await browser.GetJsonAsync<UserProfileDto>("/api/auth/me")).Look);

        await using var db = api.Database();
        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == account.Id);
        Assert.Equal(
            ("custom", "#10182a", "#c8f560", "perspective", "accent"),
            (stored.Theme, stored.ThemeBackground, stored.ThemeAccent, stored.BackgroundPattern, stored.PatternTint));
    }

    [Fact]
    public async Task UpdateLook_APresetAfterACustomPalette_ClearsTheColours()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("switcher"));
        api.Admins.Name(account.Id);
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("custom", "#10182a", "#c8f560", "none", "grey"))).ExpectAsync(HttpStatusCode.OK);

        // Sent with the old colours still in it, as a page might: a preset keeps none of them.
        var saved = await (await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("plum", "#10182a", "#c8f560", "none", "grey")))
            .ReadAsync<UserProfileDto>(HttpStatusCode.OK);

        Assert.Equal(new LookDto("plum", null, null, "none", "grey"), saved.Look);
        await using var db = api.Database();
        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == account.Id);
        Assert.Equal((null, null), (stored.ThemeBackground, stored.ThemeAccent));
    }

    [Fact]
    public async Task UpdateLook_AColourNotWrittenAsSixHexDigits_AnswersAValidationProblemKeyedByTheField()
    {
        using var browser = api.CreateBrowser();
        api.Admins.Name((await browser.RegisterAsync(Browsers.NewUserName("misspelt"))).Id);

        var response = await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("custom", "lime", "#c8f560", "none", "grey"));

        var problem = await response.ReadAsync<ValidationProblemDetails>(HttpStatusCode.BadRequest);
        Assert.Equal(["Background"], problem.Errors.Keys);
    }

    [Fact]
    public async Task UpdateLook_FromAnAccountThatMayNotChoose_IsRefusedAndTheProfileSaysSo()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("member"));
        Assert.False(account.CanChooseLook);

        var response = await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("plum", null, null, "none", "grey"));

        await response.ExpectAsync(HttpStatusCode.Forbidden);
        await using var db = api.Database();
        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == account.Id);
        Assert.Equal((LookPolicy.DefaultPalette, LookPolicy.DefaultPattern), (stored.Theme, stored.BackgroundPattern));
    }

    [Fact]
    public async Task Me_AnAdminNoLongerNamed_IsDrawnInTheDefault_AndGetsItsLookBackOnceNamedAgain()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("lapsed"));
        api.Admins.Name(account.Id);
        var chose = new LookDto("dusk", null, null, "pixels", "accent");
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/look",
            new UpdateLookDto("dusk", null, null, "pixels", "accent"))).ExpectAsync(HttpStatusCode.OK);

        api.Admins.Unname(account.Id);
        var lapsed = await browser.GetJsonAsync<UserProfileDto>("/api/auth/me");

        Assert.Equal((false, LookDto.Default), (lapsed.CanChooseLook, lapsed.Look));

        api.Admins.Name(account.Id);
        Assert.Equal(chose, (await browser.GetJsonAsync<UserProfileDto>("/api/auth/me")).Look);
    }

    [Theory]
    [InlineData("dark", null, null)]
    [InlineData("custom", null, null)]
    [InlineData("custom", "#10182a", null)]
    [InlineData("slate", "#10182a", "#c8f560")]
    [InlineData("custom", "#10182A", "#c8f560")]
    public async Task CheckConstraints_ALookTheEndpointWouldNeverWrite_IsRefused(string theme, string? background, string? accent)
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("forced"));

        await using var db = api.Database();
        var user = await db.Users.SingleAsync(u => u.Id == account.Id);
        (user.Theme, user.ThemeBackground, user.ThemeAccent) = (theme, background, accent);

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
