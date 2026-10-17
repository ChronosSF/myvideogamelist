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
