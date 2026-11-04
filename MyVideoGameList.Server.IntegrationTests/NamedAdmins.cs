using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The admin list, as a test sets it while the host runs: an account's id is drawn as it registers, so no
/// setting given before the host starts could name it. Stands in for the monitor of
/// <see cref="AdminOptions"/>, which is all <see cref="AdminAccounts"/> reads, so the policy and
/// <c>/api/auth/me</c> both answer from it as they would from configuration.
/// </summary>
public sealed class NamedAdmins : IOptionsMonitor<AdminOptions>
{
    private readonly ConcurrentDictionary<string, byte> ids = new();

    public void Name(string accountId) => ids[accountId] = 0;

    public void Unname(string accountId) => ids.TryRemove(accountId, out _);

    public AdminOptions CurrentValue => new() { AccountIds = [.. ids.Keys] };

    public AdminOptions Get(string? name) => CurrentValue;

    public IDisposable? OnChange(Action<AdminOptions, string?> listener) => null;
}
