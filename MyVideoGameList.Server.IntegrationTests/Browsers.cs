using System.Net;
using System.Net.Http.Json;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// What a test does through a browser from <see cref="ApiFactory.CreateBrowser"/>.
/// </summary>
internal static class Browsers
{
    /// <summary>Every test account's password: a digit, lower case, eight or more (Program.cs).</summary>
    public const string Password = "integration-test-1";

    private static int names;

    /// <summary>
    /// A username nothing else in this run has claimed, from a prefix of up to twelve characters.
    /// The tests in a class share its database, so a fixed name would be taken by the second.
    /// </summary>
    public static string NewUserName(string prefix) => $"{prefix}_{Interlocked.Increment(ref names)}";

    /// <summary>Registers an account, which also signs this browser in as it.</summary>
    public static async Task<UserProfileDto> RegisterAsync(this HttpClient browser, string userName)
    {
        var response = await browser.PostAsJsonAsync(
            "/api/auth/register", new RegisterDto($"{userName}@test.local", Password, userName));

        return await response.ReadAsync<UserProfileDto>(HttpStatusCode.OK);
    }

    /// <summary>
    /// Uploads a Grouvee export with one shelved game per id, each naming its IGDB id, which makes
    /// a pending import job with a row apiece and asks IGDB nothing (ADR 0037).
    /// </summary>
    /// <remarks>The shape is the unit tests' fixture, which is copied from a real export.</remarks>
    public static async Task<ImportJobDto> UploadGrouveeAsync(this HttpClient browser, params int[] gameIds)
    {
        var collection = string.Join(", ", gameIds.Select(id => $$$"""
            {
              "id": {{{id}}},
              "name": "Game {{{id}}}",
              "shelves": {"Played": {"date_added": "2021-10-02T06:54:47Z"}},
              "platforms": {"PlayStation 2": {"url": "https://www.grouvee.com/games/platform/55-playstation-2/"}},
              "rating": 5,
              "review_title": "",
              "review": "",
              "dates": [{"date_started": "None", "date_finished": "None", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}],
              "release_date": "2004-11-17",
              "date_added_to_collection": "2021-10-02",
              "igdb_id": {{{id}}}
            }
            """));

        var document = $$"""
            {
              "export_format_version": 2,
              "account": { "favorite_games": [] },
              "collection": [{{collection}}],
              "lists": [], "reviews": [], "play_log": [], "statuses": [], "comments": []
            }
            """;

        using var form = new MultipartFormDataContent { { new StringContent(document), "file", "grouvee.json" } };
        var response = await browser.PostAsync("/api/import/jobs", form);
        return await response.ReadAsync<ImportJobDto>(HttpStatusCode.Created);
    }

    /// <summary>Sends a request with a JSON body, as <c>apiFetch</c> does.</summary>
    public static Task<HttpResponseMessage> SendAsync(
        this HttpClient browser, HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        return browser.SendAsync(request);
    }

    /// <summary>Fails with what the API said, rather than with only the status it said it in.</summary>
    public static async Task ExpectAsync(this HttpResponseMessage response, HttpStatusCode status)
    {
        if (response.StatusCode == status) return;

        Assert.Fail(
            $"{response.RequestMessage?.Method} {response.RequestMessage?.RequestUri?.PathAndQuery} answered "
            + $"{(int)response.StatusCode} rather than {(int)status}: {await response.Content.ReadAsStringAsync()}");
    }

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response, HttpStatusCode status)
    {
        await response.ExpectAsync(status);
        return await response.Content.ReadFromJsonAsync<T>()
            ?? throw new InvalidOperationException($"The body was empty where a {typeof(T).Name} was expected.");
    }

    /// <summary>A read that has to succeed, failing with the body when it does not.</summary>
    public static async Task<T> GetJsonAsync<T>(this HttpClient browser, string path) =>
        await (await browser.GetAsync(path)).ReadAsync<T>(HttpStatusCode.OK);
}
